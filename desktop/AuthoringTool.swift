// Verso - native macOS shell for the DIY Authoring Tool.
// A thin WKWebView window (no browser chrome) that spawns the
// local python static server against the live code root and loads it.
// Everything is local: no cloud, no network egress, air-gap safe.
//
// Content root resolution order:
//   1. $AUTHORING_ROOT environment variable (override for a moved app)
//   2. the repo root derived from the running binary's location (walk up until an
//      index.html is found), so no absolute path is baked in.
//   3. the current working directory as a last resort.
// The app points at the LIVE dev tree on purpose: edits
// show up on Cmd-R reload, no rebuild needed.

import AppKit
import WebKit
import Darwin

func defaultRoot() -> String {
    var dir = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
    for _ in 0..<6 {
        if FileManager.default.fileExists(atPath: dir.appendingPathComponent("index.html").path) { return dir.path }
        dir = dir.deletingLastPathComponent()
    }
    return FileManager.default.currentDirectoryPath
}

func contentRoot() -> String {
    if let env = ProcessInfo.processInfo.environment["AUTHORING_ROOT"], !env.isEmpty {
        return env
    }
    return defaultRoot()
}

// Fixed port so the origin (http://localhost:8123) is STABLE across launches
// and identical to serve.command. localStorage is keyed by origin, so a stable
// origin means Verso and the browser share one set of saved docs/theme/layout.
let PORT: UInt16 = 8123

// Returns true once something accepts a TCP connection on the port.
func serverIsUp(_ port: UInt16) -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(fd) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    addr.sin_port = port.bigEndian
    let sz = socklen_t(MemoryLayout<sockaddr_in>.size)
    let rc = withUnsafePointer(to: &addr) { p in
        p.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, sz) }
    }
    return rc == 0
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    let port = PORT
    var startedServer = false
    // Destination chosen for each in-flight WKDownload, so we can reveal it on finish.
    var downloadURLs: [ObjectIdentifier: URL] = [:]

    func applicationDidFinishLaunching(_ note: Notification) {
        // Reuse an already-running server on this port (e.g. serve.command);
        // only spawn our own if nothing is there. This keeps a single shared origin.
        if !serverIsUp(port) { startServer() }

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled") // right-click Inspect Element
        // Native colour-sampler bridge: gives the editor's eyedropper a working
        // implementation in Verso (the web EyeDropper API is Chromium-only, absent in WKWebView).
        config.userContentController.add(self, name: "pickColor")
        // Native project-backup bridge: the File System Access API (showDirectoryPicker /
        // folder writes) is Chromium-only, absent in WKWebView. Verso is NOT sandboxed, so
        // it has full filesystem access -> a native NSOpenPanel folder pick + FileManager
        // writes give the editor a durable auto-backup path with no browser FSA + no re-grant.
        config.userContentController.add(self, name: "versoBackup")
        // Canvas-perf bridge (#151): rasterise a screen rect to a PNG via WKWebView's native
        // takeSnapshot -- REAL fonts/images, no taint (the SVG-foreignObject route can't load
        // @font-face in image mode). The editor shows this cached bitmap while pan/zooming so
        // the compositor scales one texture instead of re-rasterising the whole page DOM per
        // frame, then snaps back to the live DOM on settle. Reply is pumped to
        // window.__nativeSnapshotReply(reqId, dataUrl). Web falls back to the CSS LOD if absent.
        config.userContentController.add(self, name: "nativeSnapshot")
        // Native-file storage (#68): inject the on-disk registry at document-start so the web
        // layer's SYNCHRONOUS boot read can pick it up when authoring.storageBackend == 'file'.
        // The registry lives in an app-managed store dir (no localStorage ~5MB cap). Harmless
        // under the default 'browser' backend (the web side ignores the global then). The
        // injection is refreshed from disk before every reload (see reload/forceReload) so a
        // Cmd+R re-reads the CURRENT registry, not the stale launch-time snapshot.
        config.userContentController.addUserScript(registryInjectionScript())
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsMagnification = true
        // macOS 13.3+ modern flag (complements developerExtrasEnabled above): makes the
        // WKWebView inspectable so the Develop menu / Cmd+Opt+I Web Inspector works.
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Verso"
        window.center()
        window.setFrameAutosaveName("AuthoringToolWindow")
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        buildMenu()
        loadWhenReady()
        NSApp.activate(ignoringOtherApps: true)
    }

    // WKWebView shows NO native file picker unless the host app supplies one.
    // Without this, every <input type=file> click (e.g. Upload logo) silently
    // does nothing in Verso while working fine in a real browser.
    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.begin { result in
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }

    // ---- Downloads (OOO) --------------------------------------------------
    // WKWebView performs NO download unless the host app routes it. A blob
    // <a download> click (SCORM export, Export JSON, version backups) otherwise
    // SILENTLY no-ops in Verso while working fine in a real browser -- which is
    // exactly the "Save produced no file" show-stopper. Route any download-flagged
    // navigation, or any response the webview can't render inline (a .zip), to a
    // WKDownload and present a native Save panel.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
        } else {
            decisionHandler(.allow, preferences)
        }
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.canShowMIMEType {
            decisionHandler(.allow)
        } else {
            decisionHandler(.download)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.begin { result in
            guard result == .OK, let url = panel.url else { completionHandler(nil); return }
            // WKDownload requires a NEW file at the destination; clear any existing one.
            try? FileManager.default.removeItem(at: url)
            self.downloadURLs[ObjectIdentifier(download)] = url
            completionHandler(url)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        if let url = downloadURLs[key] {
            NSWorkspace.shared.activateFileViewerSelecting([url]) // reveal in Finder
        }
        downloadURLs[key] = nil
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadURLs[ObjectIdentifier(download)] = nil
        let a = NSAlert()
        a.messageText = "Download failed"
        a.informativeText = error.localizedDescription
        a.runModal()
    }

    // ---- JS dialogs (YYY) -------------------------------------------------
    // WKWebView shows NO alert()/confirm()/prompt() unless the host provides
    // panels. Without these they SILENTLY no-op in Verso (confirm -> false,
    // prompt -> nil), so data-loss warnings, the EEE pre-export check, delete
    // confirms and component-name prompts all silently fail. Provide native ones.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = "Verso"
        a.informativeText = message
        a.addButton(withTitle: "OK")
        a.runModal()
        completionHandler()
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = "Verso"
        a.informativeText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert()
        a.messageText = "Verso"
        a.informativeText = prompt
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        let resp = a.runModal()
        completionHandler(resp == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    func startServer() {
        // Inline server that self-terminates when its parent (Verso) dies, so a
        // force-quit / crash never leaves an orphaned python holding the port.
        let script = """
        import http.server, socketserver, threading, os, time, sys
        port = int(sys.argv[1]); parent = os.getppid()
        socketserver.TCPServer.allow_reuse_address = True
        class H(http.server.SimpleHTTPRequestHandler):
            # Never cache: the code is edited live, so every
            # load must be the latest file on disk. No hard-reload needed.
            def end_headers(self):
                self.send_header("Cache-Control", "no-store, must-revalidate")
                self.send_header("Expires", "0")
                http.server.SimpleHTTPRequestHandler.end_headers(self)
            def log_message(self, *a): pass
        httpd = socketserver.TCPServer(("127.0.0.1", port), H)
        def watch():
            while True:
                if os.getppid() != parent: os._exit(0)
                time.sleep(0.5)
        threading.Thread(target=watch, daemon=True).start()
        httpd.serve_forever()
        """
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["python3", "-c", script, String(port)]
        p.currentDirectoryURL = URL(fileURLWithPath: contentRoot())
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run(); server = p; startedServer = true }
        catch { fatalError("Could not start python3 server: \(error)") }
    }

    // Poll off the main thread; load the URL once the server answers.
    func loadWhenReady() {
        let target = port
        DispatchQueue.global().async { [weak self] in
            let deadline = Date().addingTimeInterval(10)
            while Date() < deadline {
                if serverIsUp(target) {
                    DispatchQueue.main.async { self?.load() }
                    return
                }
                usleep(100_000) // 100ms
            }
            DispatchQueue.main.async { self?.showServerError() }
        }
    }

    func load() {
        let url = URL(string: "http://localhost:\(port)/index.html")!
        webView.load(URLRequest(url: url))
    }

    func showServerError() {
        let a = NSAlert()
        a.messageText = "Could not start the local server"
        a.informativeText = "python3 did not come up. Check that the content root exists:\n\n\(contentRoot())"
        a.runModal()
    }

    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Verso", action: nil, keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        // Edit menu (UUU). WKWebView has no built-in Edit menu, so with none here
        // Cmd+C/V/X/A never reach web content -> clipboard is dead in Verso (paste
        // into any text block does nothing). These items target the first responder
        // (nil target) via the standard responder-chain selectors WKWebView
        // implements, restoring Cut/Copy/Paste/Select All app-wide.
        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        let forceReload = NSMenuItem(title: "Reload (clear cache)", action: #selector(forceReload), keyEquivalent: "r")
        forceReload.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(forceReload)
        viewItem.submenu = viewMenu

        // Develop menu: open the Web Inspector (Console/Elements) with Cmd+Opt+I, the
        // same shortcut as Chrome/Safari. There is no PUBLIC API to open the WKWebView
        // inspector, so showWebInspector() uses the private _inspector.show: (fine for a
        // personal air-gapped dev tool; guarded by responds(to:)). Right-click ->
        // Inspect Element also still works via developerExtrasEnabled.
        let devItem = NSMenuItem()
        main.addItem(devItem)
        let devMenu = NSMenu(title: "Develop")
        let inspect = NSMenuItem(title: "Show Web Inspector", action: #selector(showWebInspector), keyEquivalent: "i")
        inspect.keyEquivalentModifierMask = [.command, .option]
        devMenu.addItem(inspect)
        // One-click diagnostic that does NOT need the console: runs the text-colour scan
        // in the page and writes the JSON to ~/Desktop/verso-colour-dump.json, then
        // reveals it in Finder. Robust even when the inspector can't be opened.
        let dump = NSMenuItem(title: "Dump text colours to Desktop", action: #selector(dumpTextColours), keyEquivalent: "d")
        dump.keyEquivalentModifierMask = [.command, .option]
        devMenu.addItem(dump)
        devItem.submenu = devMenu

        NSApp.mainMenu = main
    }

    @objc func reload() { refreshRegistryInjection(); webView.reload() }
    @objc func forceReload() { refreshRegistryInjection(); webView.reloadFromOrigin() }
    @objc func showWebInspector() {
        // No public API opens the WKWebView inspector. Fetch the private _inspector and
        // try the method names WebKit has used across versions: -showConsole (jumps
        // straight to the Console, what we want), -show, then -show:. Guarded by
        // responds(to:) so a future rename just no-ops rather than crashes.
        let inspSel = Selector(("_inspector"))
        guard webView.responds(to: inspSel),
              let insp = webView.perform(inspSel)?.takeUnretainedValue() as? NSObject else {
            fallbackInspectHint(); return
        }
        for name in ["showConsole", "show"] {
            let sel = Selector((name))
            if insp.responds(to: sel) { insp.perform(sel); return }
        }
        let showColon = Selector(("show:"))
        if insp.responds(to: showColon) { insp.perform(showColon, with: nil); return }
        fallbackInspectHint()
    }
    @objc func dumpTextColours() {
        let js = """
        (function(){
          var out={ codeLoaded:{ stripStyledColorsDeep: typeof window.__stripStyledColorsDeep, stripInlineColor: typeof window.__stripInlineColor, applyTextStyle: typeof window.applyTextStyle } };
          try{ out.namedStyles = (window.Editor&&window.Editor.getDoc)? (window.Editor.getDoc().styles||"(no doc.styles)") : "(no Editor)"; }catch(e){ out.namedStyles="ERR "+e; }
          // remaining inline colour in the DOC MODEL (post-load): if >0, the strip did NOT run on this doc
          var stray=[];
          try{ (function scan(o){ if(Array.isArray(o))return o.forEach(scan); if(o&&typeof o==="object"){ for(var k in o){ var v=o[k]; if(typeof v==="string"){ if(k==="html"||k==="svg"||k==="src")continue; if(/<!doctype|<html[\\s>]/i.test(v))continue; if(/color\\s*:/i.test(v)) stray.push({type:o.type,styleRef:o.styleRef||"(none)",field:k,snippet:v.slice(0,140)}); } else scan(v); } } })(window.Editor.getDoc()); }catch(e){}
          out.strayInlineColourInModel = stray;
          // what actually RENDERS: per visible text node, computed colour + why
          var nodes=document.querySelectorAll('.page [data-edit], .page .body-note, .page .body-list, .page p, .page li'), seen=[], rep=[];
          [].forEach.call(nodes,function(n){ if(seen.indexOf(n)>=0)return; seen.push(n); var cs=getComputedStyle(n); var innerM=(n.innerHTML.match(/color\\s*:[^;\"']*/i)||[])[0]; rep.push({ cls:(n.className||"").slice(0,60), inlineNodeColor:n.style.color||"(none)", computed:cs.color, innerSpanColor:innerM||"(none)", text:(n.textContent||"").replace(/\\s+/g," ").slice(0,45) }); });
          out.rendered = rep.slice(0,50);
          return JSON.stringify(out,null,2);
        })()
        """
        webView.evaluateJavaScript(js) { result, error in
            let text: String
            if let s = result as? String { text = s }
            else if let e = error { text = "ERROR: \(e.localizedDescription)" }
            else { text = "(no result)" }
            let url = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Desktop/verso-colour-dump.json")
            try? text.data(using: .utf8)?.write(to: url)
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }
    func fallbackInspectHint() {
        let a = NSAlert()
        a.messageText = "Web Inspector shortcut unavailable"
        a.informativeText = "This macOS/WebKit build doesn't expose the inspector programmatically. Right-click anywhere in the page and choose \"Inspect Element\" to open it, then use the Console tab."
        a.runModal()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ note: Notification) {
        // Only stop the server if we started it; never kill a serve.command the user is running.
        if startedServer { server?.terminate() }
    }
}

// Native screen colour sampler (eyedropper) — the editor calls
// webkit.messageHandlers.pickColor.postMessage("") when the web EyeDropper API is
// absent (Verso/WKWebView); we run NSColorSampler and hand the sRGB hex back to JS.
extension AppDelegate: WKScriptMessageHandler {
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "versoBackup" { handleBackup(message); return }
        if message.name == "nativeSnapshot" { handleSnapshot(message); return }
        guard message.name == "pickColor" else { return }
        func resolve(_ hex: String?) {
            let arg = hex.map { "'\($0)'" } ?? "null"
            self.webView.evaluateJavaScript("window.__nativeColorResolve && window.__nativeColorResolve(\(arg))", completionHandler: nil)
        }
        if #available(macOS 10.15, *) {
            NSColorSampler().show { picked in
                if let c = picked?.usingColorSpace(.sRGB) {
                    let r = Int((c.redComponent * 255).rounded())
                    let g = Int((c.greenComponent * 255).rounded())
                    let b = Int((c.blueComponent * 255).rounded())
                    resolve(String(format: "#%02x%02x%02x", r, g, b))
                } else { resolve(nil) }
            }
        } else { resolve(nil) }
    }

    // Canvas-perf snapshot (#151). JS posts {reqId, x, y, w, h} (CSS px in the webView's own
    // coordinate space, top-left origin); we snapshot that rect with the native rasteriser and
    // reply window.__nativeSnapshotReply(reqId, dataUrl|null). afterScreenUpdates=false grabs
    // the CURRENT compositor frame (fast, no forced relayout) -- the editor requests it at the
    // START of a gesture while the live DOM is still on screen, then swaps the bitmap in.
    func handleSnapshot(_ message: WKScriptMessage) {
        guard let d = message.body as? [String: Any], let reqId = d["reqId"] as? String else { return }
        func reply(_ dataUrl: String?) {
            let arg = dataUrl.map { "'\($0)'" } ?? "null"
            self.webView.evaluateJavaScript("window.__nativeSnapshotReply && window.__nativeSnapshotReply('\(reqId)', \(arg))", completionHandler: nil)
        }
        let x = (d["x"] as? NSNumber)?.doubleValue ?? 0
        let y = (d["y"] as? NSNumber)?.doubleValue ?? 0
        let w = (d["w"] as? NSNumber)?.doubleValue ?? 0
        let h = (d["h"] as? NSNumber)?.doubleValue ?? 0
        let cfg = WKSnapshotConfiguration()
        if w > 0 && h > 0 { cfg.rect = CGRect(x: x, y: y, width: w, height: h) }
        // afterScreenUpdates=false returns a BLACK/empty frame on macOS WKWebView (observed on
        // the reference course). true renders pending updates first -> a real bitmap, at the cost of a relayout.
        cfg.afterScreenUpdates = true
        webView.takeSnapshot(with: cfg) { image, _ in
            guard let image = image, let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else { reply(nil); return }
            reply("data:image/png;base64," + png.base64EncodedString())
        }
    }

    // App-managed native store dir (#68): ~/Library/Application Support/Verso/store.
    // The working store (registry + #69 pre-cutover backups); .verso stays the portable
    // artifact. All store-relative paths from JS are resolved under here.
    func storeDir() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("Verso/store", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    // Resolve a JS-supplied store-relative path safely (reject absolute / parent escapes).
    func storePath(_ rel: String) -> URL? {
        if rel.hasPrefix("/") || rel.contains("..") { return nil }
        return storeDir().appendingPathComponent(rel)
    }
    // Builds the document-start user script that hands the on-disk registry to the web layer
    // (base64 so any JSON escapes safely). Rebuilt from CURRENT disk on each reload.
    func registryInjectionScript() -> WKUserScript {
        let regText = (try? String(contentsOf: storeDir().appendingPathComponent("registry.json"), encoding: .utf8)) ?? ""
        let regB64 = Data(regText.utf8).base64EncodedString()
        return WKUserScript(source: "window.__versoDiskRegistryB64 = \"\(regB64)\";",
                            injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }
    // Re-read the on-disk registry into the injection before a reload, so Cmd+R (and the
    // #69 controlled reload) reflects the latest saved state (only the registry injection
    // is ever added via addUserScript).
    func refreshRegistryInjection() {
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(registryInjectionScript())
    }

    // Native project-backup ops. JS posts
    // webkit.messageHandlers.versoBackup.postMessage({op, reqId, ...}); we reply via
    // window.__versoBackupReply(reqId, resultObj). Non-sandboxed -> plain FileManager.
    func handleBackup(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let op = body["op"] as? String,
              let reqId = body["reqId"] as? String else { return }
        func reply(_ obj: [String: Any]) {
            let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
            let json = String(data: data, encoding: .utf8) ?? "{}"
            DispatchQueue.main.async {
                self.webView.evaluateJavaScript("window.__versoBackupReply && window.__versoBackupReply('\(reqId)', \(json))", completionHandler: nil)
            }
        }
        if op == "pickFolder" {
            let panel = NSOpenPanel()
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            panel.prompt = "Choose backup folder"
            panel.message = "Pick this course's project folder — Verso will auto-save a copy here."
            panel.begin { result in
                if result == .OK, let url = panel.urls.first {
                    reply(["ok": true, "path": url.path, "name": url.lastPathComponent])
                } else { reply(["ok": false]) }
            }
        } else if op == "write" {
            guard let folder = body["folder"] as? String,
                  let files = body["files"] as? [[String: Any]] else { reply(["ok": false, "error": "bad args"]); return }
            let dir = URL(fileURLWithPath: folder, isDirectory: true)
            var err: String? = nil
            for f in files {
                guard let name = f["name"] as? String, let text = f["text"] as? String else { continue }
                do { try text.data(using: .utf8)?.write(to: dir.appendingPathComponent(name), options: .atomic) }
                catch { err = error.localizedDescription }
            }
            reply(err == nil ? ["ok": true] : ["ok": false, "error": err!])
        } else if op == "storePutRegistry" {
            // Native-file storage (#68/#69): durable, atomic write of the registry to disk.
            // No ~5MB cap. Injected back at the next launch/reload by the user script.
            guard let text = body["text"] as? String else { reply(["ok": false, "error": "bad args"]); return }
            let url = storeDir().appendingPathComponent("registry.json")
            do {
                try Data(text.utf8).write(to: url, options: .atomic)
                // P0 DATA-LOSS FIX: keep the document-start injection in lockstep with disk on
                // EVERY save. The injection is a static WKUserScript snapshot; it was only
                // refreshed inside reload()/forceReload(), so a reload that bypasses those (a
                // web-initiated location.reload, or any non-menu path) re-ran the STALE
                // launch-time snapshot. Boot then loaded that stale registry and a boot-time
                // save wrote it straight back over registry.json -- destroying the just-saved
                // edits on disk. Refreshing here means any reload path boots the CURRENT
                // registry, so the clobber can never happen.
                DispatchQueue.main.async { self.refreshRegistryInjection() }
                reply(["ok": true, "path": url.path])
            }
            catch { reply(["ok": false, "error": error.localizedDescription]) }
        } else if op == "storeGetRegistry" {
            // Read the on-disk registry back (the #69 migration's verify-from-disk step).
            let url = storeDir().appendingPathComponent("registry.json")
            if let text = try? String(contentsOf: url, encoding: .utf8) { reply(["ok": true, "text": text]) }
            else { reply(["ok": true, "text": NSNull()]) } // absent = not-yet-migrated, not an error
        } else if op == "storePutBackupB64" {
            // #69 backup gate: write one binary artifact (base64) under store/<path>, atomic,
            // creating intermediate dirs (e.g. backups/pre-cutover-<ts>/<code>.verso).
            guard let rel = body["path"] as? String, let b64 = body["b64"] as? String,
                  let url = storePath(rel), let data = Data(base64Encoded: b64) else { reply(["ok": false, "error": "bad args"]); return }
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: url, options: .atomic)
                reply(["ok": true, "size": data.count])
            } catch { reply(["ok": false, "error": error.localizedDescription]) }
        } else if op == "storeFileSize" {
            // On-disk size of store/<path> (0 if absent) — the "verified written" check.
            guard let rel = body["path"] as? String, let url = storePath(rel) else { reply(["ok": false, "error": "bad args"]); return }
            let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
            let size = (attrs?[.size] as? Int) ?? 0
            reply(["ok": true, "size": size])
        } else if op == "storeReload" {
            // #69 controlled reload under the migrated store (refreshes the injection first).
            DispatchQueue.main.async { self.reload() }
            reply(["ok": true]) // best-effort; the page tears down as it reloads
        } else { reply(["ok": false, "error": "unknown op"]) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
