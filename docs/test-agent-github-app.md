# Test-agent GitHub App setup

## Goal

Create a dedicated GitHub App identity for the bounded P004 test-driver agent so its commits, pushes, PR comments, and PRs are distinguishable from main `obot-claw` development work.

Proposed app name: `obot-test-agent`

## Why a GitHub App

A GitHub App is better than a shared PAT or the main obot identity because it gives a separate bot actor, scoped repository permissions, install/uninstall controls, and a distinct audit trail.

## Required setup action

Jeremy or an `obot-claw` organization owner must create/install the app. I can prepare the configuration, but GitHub App registration is an org-owner browser action.

Prepared registration URL:

```text
https://github.com/organizations/obot-claw/settings/apps/new?name=obot-test-agent&description=Bounded%20P004%20test-driver%20agent%20for%20Vitest%2FPlaywright%20evidence%20commits%20and%20PRs&url=https%3A%2F%2Fgithub.com%2Fobot-claw%2Fsafety-agent&public=false&webhook_active=false&contents=write&pull_requests=write&issues=write&actions=read&checks=read&statuses=read
```

The same URL is stored in `config/github-app/obot-test-agent-url.txt`.

A manifest-style configuration is stored in `config/github-app/obot-test-agent-manifest.json`.

## Requested permissions

| Permission | Access | Rationale |
|---|---|---|
| Contents | Read/write | Push test-agent branches and commits. |
| Pull requests | Read/write | Open/update PRs and comments for test evidence. |
| Issues | Read/write | Link requirements, issues, and test evidence. |
| Actions | Read | Inspect workflow runs. |
| Checks | Read | Inspect check results. |
| Commit statuses | Read | Inspect legacy status contexts. |
| Metadata | Read | Required by GitHub Apps. |

No webhook events are required initially. Keep webhooks disabled until we need automation triggered by GitHub events.

## Installation scope

Install initially on selected repositories only:

1. `obot-claw/safety-agent`
2. first active nextgen renderer repo, e.g. `obot-claw/safety-histogram`

Do not grant all-repository access until the workflow has proven useful.

## Local usage model

After the app is created and installed, record these values in the local secret store or environment, not in git:

- GitHub App ID
- Installation ID
- Private key PEM
- App slug / bot email once GitHub shows it

The test-driver workflow should then:

1. Generate a short-lived installation token.
2. Set git author to the app bot identity.
3. Push using the installation token.
4. Open/update PRs with the installation token.
5. Include `Test-driver evidence` notes in PR comments.

Expected commit identity pattern, to be confirmed after app creation:

```bash
git config user.name "obot-test-agent[bot]"
git config user.email "<app-id>+obot-test-agent[bot]@users.noreply.github.com"
```

Do not hard-code this until the app exists and GitHub exposes the exact bot identity.


## Interim commit separation before app installation

Until `obot-test-agent` exists and has credentials configured, separate test-driver and implementation work by branch/commit discipline:

- Prefix test-driver commits with `test-driver:`.
- Keep implementation commits separate from test/evidence commits.
- Do not mix renderer implementation edits with test-driver evidence edits in one commit unless explicitly approved.
- If one PR contains both workstreams, list test-driver commits and implementation commits separately in the PR summary.

## Test-driver guardrails

The app should only be used by the bounded test-driver workflow:

- It may commit tests, fixtures, demo QA notes, and evidence reports.
- It may open PRs or comments for test evidence.
- It should not modify product implementation unless explicitly assigned.
- It should not edit workflow files without separate review.
- It should not be installed outside `obot-claw` repositories unless Jeremy explicitly approves.

## References

- GitHub Docs: Registering a GitHub App using URL parameters
  - https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-using-url-parameters
- GitHub Docs: Registering a GitHub App from a manifest
  - https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
