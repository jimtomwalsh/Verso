/*
 * Minimal SCORM 1.2 content-side API wrapper.
 *
 * SCORM 1.2 does not let content implement LMSInitialize/LMSGetValue/etc itself -
 * the LMS (Moodle) injects an object named "API" somewhere in the parent/opener
 * window chain, and content is responsible for finding it and calling its six
 * methods correctly. This file is that content-side wrapper: API discovery,
 * call-sequencing rules, and a couple of small helpers for the two data model
 * fields this spike cares about (lesson_status, score).
 *
 * Exposes a single global: SCORM.init(), SCORM.setStatus(), SCORM.setScore(),
 * SCORM.save(), SCORM.quit(), SCORM.get(name), SCORM.set(name, value).
 */
var SCORM = (function () {
  "use strict";

  var api = null;
  var initialized = false;
  var finished = false;

  // SCORM 1.2 error codes worth naming; everything else just gets logged raw.
  var ERROR_NO_ERROR = "0";

  function findAPI(win) {
    var depth = 0;
    var maxDepth = 10; // generous ceiling for nested iframes; real LMS wrappers are rarely more than 2-3 deep
    while (win.API == null && win.parent != null && win.parent !== win && depth < maxDepth) {
      depth++;
      win = win.parent;
    }
    return win.API || null;
  }

  function locateAPI() {
    var found = findAPI(window);
    if (found == null && window.opener != null) {
      found = findAPI(window.opener);
    }
    if (found == null) {
      console.error("SCORM: could not locate an API adapter in the parent/opener window chain.");
    }
    return found;
  }

  function checkError(context) {
    if (api == null) {
      return;
    }
    var code = api.LMSGetLastError();
    if (code !== ERROR_NO_ERROR) {
      var diagnostic = "";
      if (typeof api.LMSGetDiagnostic === "function") {
        diagnostic = api.LMSGetDiagnostic(code);
      }
      console.warn("SCORM error during " + context + ": code " + code + " " + diagnostic);
    }
  }

  function init() {
    if (initialized) {
      return true;
    }
    api = locateAPI();
    if (api == null) {
      return false;
    }
    var result = api.LMSInitialize("");
    checkError("LMSInitialize");
    initialized = result === "true" || result === true;
    return initialized;
  }

  function get(name) {
    if (!initialized || api == null) {
      return "";
    }
    var value = api.LMSGetValue(name);
    checkError("LMSGetValue(" + name + ")");
    return value;
  }

  function set(name, value) {
    if (!initialized || api == null) {
      return false;
    }
    var result = api.LMSSetValue(name, value);
    checkError("LMSSetValue(" + name + ", " + value + ")");
    return result === "true" || result === true;
  }

  function save() {
    if (!initialized || api == null) {
      return false;
    }
    var result = api.LMSCommit("");
    checkError("LMSCommit");
    return result === "true" || result === true;
  }

  // exitType selects the SCORM 1.2 `cmi.core.exit` reason: "logout" for a
  // deliberate Exit-course action (asks the LMS to end + return the learner —
  // Moodle stays on the SCO for a normal/empty exit), "suspend" to resume later,
  // "" (default) for an incidental unload (refresh / navigate-away).
  function quit(exitType) {
    if (!initialized || finished || api == null) {
      return false;
    }
    set("cmi.core.exit", exitType || "");
    save();
    var result = api.LMSFinish("");
    checkError("LMSFinish");
    finished = result === "true" || result === true;
    return finished;
  }

  // Convenience wrapper: SCORM 1.2 lesson_status must be one of a fixed vocabulary.
  function setStatus(status) {
    var allowed = ["passed", "completed", "failed", "incomplete", "browsed", "not attempted"];
    if (allowed.indexOf(status) === -1) {
      console.error("SCORM: '" + status + "' is not a valid cmi.core.lesson_status value.");
      return false;
    }
    return set("cmi.core.lesson_status", status);
  }

  // Convenience wrapper: SCORM 1.2 scores are three separate string fields.
  function setScore(raw, min, max) {
    set("cmi.core.score.min", String(min));
    set("cmi.core.score.max", String(max));
    return set("cmi.core.score.raw", String(raw));
  }

  // The learner's LMS id — used by the exported course to key per-student prefs
  // (e.g. the chosen dark/light theme). Returns "" before init or if the LMS
  // withholds it; callers must tolerate an empty string.
  function getStudentId() {
    return get("cmi.core.student_id") || "";
  }

  return {
    init: init,
    get: get,
    set: set,
    save: save,
    quit: quit,
    setStatus: setStatus,
    setScore: setScore,
    getStudentId: getStudentId
  };
})();
