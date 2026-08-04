## 10. Variants

A course can carry **product variants** (e.g. two hardware models) that share most content but
differ in specifics. You author one **flagship**; each variant is a thin layer of overrides on
top, so unchanged copy stays shared and you maintain one source.

- **Switch flagship or variant** from the editor header. **Flagship** is the editable master; picking
  a variant shows a read-only preview. Edit a variant's wording where variant edits are allowed,
  and the change lands only on that variant's override.
- A block with no override for the current variant simply **inherits** the flagship copy.
- **Hide a block in one variant** from its right-click menu: **Variants ›** opens a short list with
  a *Hide in <name>* switch per variant, and **New variant…** at its foot. Software versions and
  per-variant images fold the same way. Before you have any variants there is no Variants list at
  all — just a single **Add variant…** entry, so the menu never shows you a heading with nothing
  under it.

**Compare side by side.** Switch the editor header's **Build / Read** toggle to **Read** for a
plain-text view of all course copy; **Build** returns you to the canvas. With variants, a **Single | Side by side**
toggle appears: **Side by side** adds one column per variant. A held variant cell is read-only
behind a lock — click the lock to edit it; a block with no variant yet shows a **+** to create
its copy from the flagship. Click into any row to select some text and use the **B / I / U /
Link** toolbar plus the **Weight** dropdown — the same formatting controls the canvas Inspector's
Style row uses.

**Shared Library masters inherit variants and software versions too.** If you gave a block
per-variant or per-software-version wording *before* saving it to the Shared Library (§9), every
placement of that master automatically shows the right wording for whichever variant/version the
host course is currently on — no extra setup. A placement's own **Overrides** (§9) always win
over the master's variant/version content if both target the same field. **Detach** bakes in
whatever you were previewing at the moment you detached, not the master's flagship/base content.

---
