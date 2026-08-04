## 15. Publishing to SCORM

On the **Publish** stage, queue the document and press **Publish** to build a SCORM 1.2 `.zip`.
All fonts, images, and HTML interactions are embedded, so the package is self-contained and runs
offline. Upload the `.zip` to Moodle as a SCORM activity. (The older one-off **Export SCORM** dialog,
with its full option list, is still there under the **⋯** button beside **Format**.)

**For air-gapped Moodle,** run the **`/publish`** prep on the exported package before uploading —
it embeds the Exo 2 fonts and forces an always-visible scrollbar (`scripts/scorm-publish.sh`).
Do this for every course headed for air-gapped Moodle.

**Backups.** Use **Export JSON** to save a portable copy of the whole course; **Import JSON**
restores it.

---
