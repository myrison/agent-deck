# Create Fork PR

**IMPORTANT:** This skill is project-specific for agent-deck. It ensures PRs are NEVER submitted to upstream.

## Purpose

Creates a pull request against Jason's fork (`myrison/agent-deck`) with safeguards to prevent accidental upstream submission.

## Usage

```
/create-fork-pr                    # Interactive mode - prompts for title/body
/create-fork-pr "PR title here"    # Quick mode with just title
```

## What This Skill Does

1. **Validates Environment**
   - Confirms you're in a git repository
   - Checks current branch isn't `main`
   - Verifies there are commits to PR

2. **Extracts Information**
   - Current branch name
   - Commit messages for default PR body
   - Changed files summary

3. **Safety Checks**
   - **ALWAYS** targets `myrison/agent-deck` (hardcoded)
   - **ALWAYS** targets base branch `main`
   - Shows preview before creating
   - Confirms with user before submission

4. **Creates PR**
   - Uses `gh pr create --repo myrison/agent-deck`
   - Formats with commit messages
   - Returns PR URL

## Implementation

The skill must:
- Never use `gh pr create` without `--repo myrison/agent-deck`
- Never target `asheshgoplani/agent-deck`
- Always show user what will be created before submitting
- Log all actions for transparency

## Error Handling

- If not in agent-deck repo → Error and exit
- If on `main` branch → Error and exit
- If no commits ahead of origin/main → Error and exit
- If `gh` not installed → Error and exit

## Example Flow

```
User: /create-fork-pr "fix: prevent orphaned sessions"

Assistant executes:
1. Runs validation checks (git repo, branch, commits)
2. Generates PR body from commit messages
3. Shows preview with target repo highlighted
4. Confirms with user
5. Creates PR targeting myrison/agent-deck
6. Returns PR URL
```

## Implementation Instructions

When this skill is invoked, Claude should:

1. **Run the script:**
   ```bash
   cd /path/to/agent-deck
   ./.claude/skills/create-fork-pr/create-pr.sh "PR title from user or extracted from commits"
   ```

2. **If user provides title**: Pass it as first argument
3. **If no title**: Script will prompt interactively

4. **Show output to user**: The script handles all validation and output

5. **Return PR URL**: Extract from script output and present to user

## Safety Features

- ✅ Hardcoded to `myrison/agent-deck`
- ✅ Validates environment before creating
- ✅ Shows preview with repository highlighted
- ✅ Requires explicit confirmation
- ✅ Logs "FORK - CORRECT" vs "upstream" warnings
- ✅ Cannot accidentally target upstream