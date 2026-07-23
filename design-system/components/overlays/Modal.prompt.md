**Modal** — the dialog shell that replaced every raw `window.prompt`/`confirm` (D7). Two canonical patterns:

```jsx
// promptModal — name / rename
<Modal title="Rename chapter" onClose={close}
  footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
           <Button variant="primary" onClick={save}>Rename</Button></>}>
  <IconField value={name} onChange={setName} />
</Modal>

// confirmModal — destructive
<Modal title="Delete this page?" description="This can't be undone." onClose={close}
  footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
           <Button variant="danger" onClick={del}>Delete</Button></>} />
```

Always right-align the footer; primary/danger action last.
