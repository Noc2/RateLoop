# Agent Workflow Notes

- After a requested change is verified, commit it without waiting for a separate prompt unless the user explicitly asks not to commit.
- Commit independent fixes separately. Before pushing, review the changed files and group commits by concern instead of bundling unrelated fixes together.
- When the user asks to publish finished work, commit the intended fixes and push the current branch after verification passes.
