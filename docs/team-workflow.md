# Four-person creative team workflow

The Team board uses the existing shared tasks and verified member directory. New status colours, owner/focus filters and workload cards are presentation changes; they do not change account roles or Warren's private workspace permissions.

## Daily use

- **Social media strategist:** write the channel plan, captions and publishing tasks. Add a target date and record the live URL and results in task details/comments.
- **Brand manager:** write the campaign brief and review messaging, artwork and consistency.
- **Video & photography:** own shoot preparation, capture, editing and asset delivery. Link the current version for feedback.
- **Artist:** supply creative direction and review work that needs artist approval.

Create one deliverable per task with one owner, a due date, a brief, a current asset link and a reviewer. Use To do → In progress → In review → Done. For sequential brand and artist checks, update the named reviewer at each handoff, or create separate review tasks. The task board does not enforce multi-stage approval; the existing artist approval workflow remains separate.

For a release, use related task titles such as `[Release name] Brief`, `[Release name] Shoot`, `[Release name] Reel edit`, `[Release name] Brand review`, `[Release name] Artist review`, and `[Release name] Publish`. Keep publishing separate from production so a completed edit is not mistaken for a published post.

Use My work for your assignments and reviews. Owner filters show tasks assigned to that person; workload cards filter by owner and show their total pending reviews separately. Focus filters combine with the owner/My work selection. Clear filters returns to all work. Workload counts cover all loaded tasks, regardless of the active filters. Done tasks are excluded from overdue, due-today and blocked views. High-priority work is labelled and sorted before normal/low work, after blockers.

Start the week with a short planning session and assign each person's three priorities. Review blockers and overdue items midweek; record published links and results at the end of the week.

## Expansion roadmap (not implemented by this change)

1. **Campaigns:** a campaign/release ID, goal, content format and channel on each task; campaign filters and reusable brief/shoot/release templates.
2. **Content calendar:** scheduled date/time per publication, channel-specific statuses and a calendar view of the same content records.
3. **Structured handoffs:** subtasks/dependencies, staged approval and versioned asset links, with an audit trail of who approved which version.
4. **Reminders and reporting:** opt-in due-date notifications, published-content results and campaign KPIs; add platform integrations once credentials, ownership and metrics are agreed.
5. **Larger workloads:** server-side filtering and pagination beyond the existing 1,000-task cap, plus search and completion history.

New team members should come from the server-owned active member directory; never create access through a frontend role selector. Keep personal/financial artist records restricted. The workload grid grows with the member directory rather than hardcoding four people.

## Validation

61 focused tests passed, covering filters, assignments, review selection, database writes/version conflicts and existing workspace access rules. Browser checks use clearly marked fictional local fixtures. Production sign-in, real task persistence and email delivery are not claimed by these checks.
