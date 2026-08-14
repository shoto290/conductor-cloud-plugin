# conductor-cloud-plugin

A Conductor plugin that connects local workspaces to Conductor Cloud. There is no plugin code yet — this repository currently holds only the license, ignore rules, and this README.

## Setting

| Name | Description |
| --- | --- |
| `CONDUCTOR_API_KEY` | API key used to authenticate with Conductor. Required. |

Create a key at https://app.conductor.build/users/api-keys, then export it: `export CONDUCTOR_API_KEY=...`

**Never commit the key.** Keep it in your shell profile or a local `.env` file — both are ignored by `.gitignore`.

MIT licensed — see [LICENSE](LICENSE).
