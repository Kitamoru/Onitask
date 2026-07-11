# Memory Bank

This directory is intended to store persistent data that the application can read
and write at runtime.  It can be used for caching, storing user‑generated
content, or any other state that needs to survive across server restarts.

## Suggested structure

```
memory_bank/
├─ data.json        # generic JSON store (you can add your own schema)
├─ notes.txt        # plain‑text notes for quick reference
└─ <your‑files>.    # any additional files you need
```

The files are **not** committed to version control by default – add a
`.gitignore` entry if you want to keep them local only.

You can read/write these files from your Next.js code using the standard Node
`fs` module or any higher‑level library you prefer.

---
*Initialized by Cline on `$(date)`.*