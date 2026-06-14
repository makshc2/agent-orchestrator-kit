# Vue 3 Profile

After `agent-orchestrator-kit init --profile vue3`, also install Vue-specific skills:

```bash
npx vue-cursor-skills install
rsync -a --delete .cursor/skills/ .agents/skills/
./scripts/sync-local-agent-skills.sh
```

This adds: `vue-core`, `vue-pinia`, `vue-router`, `vue-axios`, `vue-architecture`, `vue-composables`, `vite`, and debug skills.

## Recommended OpenSpec config.yaml additions

```yaml
context: |
  Stack: Vue 3 (Composition API, <script setup>), Pinia, Vue Router, Vuetify/PrimeVue, Axios, Vite, TypeScript.
  Code: production-ready, no Options API, no comments.
```
