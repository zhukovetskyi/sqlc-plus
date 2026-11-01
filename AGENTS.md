# Agent Guidelines

## Verification Commands

To ensure the project is stable, always run:

- Lint: `npm run lint`
- Tests: `npm test`

The test runner starts VS Code on a virtual display through `xvfb-run`, so no
window appears on the desktop. Install Xvfb once with
`sudo apt-get install -y xvfb`. Without it, `npm test` fails fast. A visible
window is kept as `npm run test:visible`, and a fully containerized
alternative is `npm run test:docker` (requires Docker).

## Code style

Use spaces instead of tabs accross the repository, be consistent about this policy.
This project uses Prettier for auto-formatting. Agents should ensure that files are formatted according to project rules.

## Documentation and comments

Use STE (Simplified Technical English)

## Tools, frameworks and libraries

Always look for the most recent stable versions of tools, libraries and frameworks, if they are new to the project. If legacy versions are already present, prompt to update.
