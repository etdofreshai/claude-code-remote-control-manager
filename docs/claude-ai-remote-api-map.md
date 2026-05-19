# Claude.ai Remote-Control API Map

Source: sanitized analysis of `workspace/tmp/claude-ai-remote-har/claude.ai.7.har`.

This document is observational. It maps the Claude.ai web APIs involved in remote-control sessions so the CCRC server can grow a documented `/help` surface and, later, operator endpoints that proxy or automate supported remote-session actions.

## Important IDs observed

- Claude.ai remote session title: `KR Work`
- Claude.ai remote session id: `session_018EzFxwGZi4tFJV2GyTggCm`
- Runtime/control session id in websocket events: `cse_018EzFxwGZi4tFJV2GyTggCm`
- Local Claude Code session id referenced by repo artifact: `1992d031-68f7-435d-bd02-6b53e0e8a69b`
- Repo/branch metadata: `Pixel-Dash-Studios/knight-rider` on `et/iterate-on-gadgets`

## Remote-session lifecycle

1. List sessions: `GET /v1/sessions` optionally with `after_id` pagination.
2. Open one session: `GET /v1/sessions/:session_id`.
3. Fetch history: `GET /v1/sessions/:session_id/events?limit=1000` and later `after_id=...`.
4. Mark web presence: `POST /v1/code/sessions/:control_session_id/client/presence`.
5. Subscribe for live control/messages: `GET /v1/sessions/ws/:session_id/subscribe?...` websocket.
6. Send a user message/event: `POST /v1/sessions/:session_id/events`.
7. Claude.ai polls session metadata repeatedly and checks repo/PR state through GitHub helper endpoints.

## Endpoint inventory

### `GET /api/claude_code/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/user_settings`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "userId": "47cef02f-d9a4-4fcf-8b60-569ff3f9b6a0",
  "version": 45,
  "lastModified": "2026-05-18T13:48:50.062326+00:00",
  "checksum": "sha256:0c00e53a10a1861a7cdbcff3df1b619e7f10bef0cf2d5b31f78151d2b7180df8",
  "content": {
    "entries": {
      "ccd/dframe-starred-code": "string",
      "ccd/dframe-starred-cowork-remote": "{\"state\":{\"starredIds\":[]},\"version\":0,\"updatedAt\":1778871430265}",
      "ccd/dframe-store": "string"
    }
  }
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "id": 2204227,
  "uuid": "5fa81d9d-56e0-446b-9320-b3d07d0c7a61",
  "name": "ET",
  "settings": {
    "claude_console_privacy": "default_private",
    "allowed_invite_domains": null,
    "workbench_completion_feedback_enabled": null,
    "claude_ai_completion_feedback_enabled": true,
    "claude_code_metrics_logging_enabled": true,
    "claude_code_github_analytics_enabled": null,
    "claude_code_remote_control_enabled": null,
    "claude_code_routines_enabled": null,
    "claude_code_trusted_devices_required": null,
    "claude_code_penguin_mode_enabled": true,
    "claude_code_quick_web_setup_enabled": null,
    "claude_code_hide_managed_environments": null,
    "claude_code_default_worker_environment_id": null,
    "claude_code_default_worker_pool_id": null,
    "oc_overage_credit_claimed": true,
    "inline_visualizations_enabled": null,
    "claude_ai_omelette_enabled": null,
    "claude_ai_operon_enabled": null,
    "frontier_services_data_use_enabled": null,
    "lti_course_projects_enabled": null,
    "...": "16 more keys"
  },
  "capabilities": [
    "claude_max"
  ],
  "parent_organization_uuid": null,
  "rate_limit_tier": "default_claude_max_20x",
  "billing_type": "stripe_subscription",
  "free_credits_status": "available",
  "data_retention": "default",
  "api_disabled_reason": null,
  "api_disabled_until": null,
  "created_at": "2023-10-15T23:03:10.914114Z",
  "billable_usage_paused_until": null,
  "raven_type": null,
  "rate_limit_upsell": null,
  "merchant_of_record": "anthropic",
  "claude_ai_bootstrap_models_config": null,
  "has_icon": false,
  "external_mapping": null,
  "...": "4 more keys"
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/chat_conversations_v2`

- Seen: 2 time(s)
- Statuses: {200: 2}
- MIME types: {'application/json': 2}
- Query examples:
  - `limit=30&starred=false&consistency=eventual`
  - `limit=30&starred=true&consistency=eventual`
- Response shape:
```json
{
  "data": [
    {
      "uuid": "ad259b07-c96f-4301-bd4f-4cc9187d6c4a",
      "name": "Changing user skills directory path",
      "summary": "",
      "model": "claude-opus-4-7",
      "created_at": "2026-05-14T16:27:08.631747Z",
      "updated_at": "2026-05-14T16:27:47.813265Z",
      "settings": {
        "enabled_bananagrams": "NoneType",
        "enabled_web_search": "bool",
        "enabled_compass": "NoneType",
        "enabled_sourdough": "NoneType",
        "enabled_foccacia": "NoneType",
        "enabled_mcp_tools": "NoneType",
        "enabled_megaminds": "NoneType",
        "compass_mode": "NoneType",
        "paprika_mode": "str",
        "enabled_monkeys_in_a_barrel": "[REDACTED]",
        "enabled_saffron": "bool",
        "create_mode": "NoneType",
        "has_sensitive_data": "NoneType",
        "tool_search_mode": "str",
        "preview_feature_uses_artifacts": "bool",
        "preview_feature_uses_latex": "NoneType",
        "preview_feature_uses_citations": "NoneType",
        "enabled_drive_search": "NoneType",
        "enabled_artifacts_attachments": "NoneType",
        "enabled_turmeric": "bool",
        "...": "2 more keys"
      },
      "is_starred": false,
      "is_temporary": false,
      "project_uuid": null,
      "session_id": null,
      "platform": "CLAUDE_AI",
      "current_leaf_message_uuid": "019e2750-341b-7643-a67f-aebcdef3e1b7",
      "user_uuid": null,
      "project": null
    }
  ],
  "has_more": true
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/code/repos`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Query examples:
  - `skip_status=true`
- Response shape:
```json
{
  "repos": [
    {
      "repo": {
        "name": "str",
        "owner": "dict",
        "default_branch": "str",
        "visibility": "str",
        "archived": "bool",
        "disabled": "bool",
        "fork": "bool",
        "permissions": "dict",
        "size": "int",
        "description": "NoneType",
        "language": "str",
        "pushed_at": "str",
        "topics": "list"
      },
      "status": null,
      "ghe": null,
      "source_url": null
    }
  ],
  "sso_required_org_ids": null,
  "sso_required_orgs": null,
  "sso_authorize_url": null
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/cowork_settings`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "enabled": true,
  "enabled_post_mayflower": null,
  "can_be_enabled": true,
  "dittos_enabled": true,
  "otlp_endpoint": null,
  "otlp_protocol": null,
  "otlp_headers": null,
  "otlp_resource_attributes": null,
  "skip_approvals_enabled": null,
  "always_allow_for_mcp_write_tools_enabled": null,
  "first_enabled_at": null
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/experiences/claude_web`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Query examples:
  - `locale=en-US`
- Response shape:
```json
{
  "experiences": [
    {
      "id": "b8c0381c-1fb0-4f2b-aec2-ac1177296205",
      "key": "[REDACTED]",
      "content": null,
      "placement_key": "[REDACTED]",
      "template_key": "[REDACTED]",
      "enabled": true,
      "variant_key": "[REDACTED]",
      "exp_id": "",
      "config": {
        "platform": "dict"
      }
    }
  ],
  "rules": {
    "global": {
      "rate_limit": {
        "remaining": "int",
        "reset_at": "str"
      },
      "cooldown": null
    },
    "placements": {
      "home-nudge": {
        "rate_limit": "dict",
        "cooldown": "NoneType"
      },
      "spotlight": {
        "rate_limit": "dict",
        "cooldown": "NoneType"
      },
      "chat-tooltip": {
        "rate_limit": "dict",
        "cooldown": "NoneType"
      },
      "cowork": {
        "rate_limit": "NoneType",
        "cooldown": "NoneType"
      },
      "global-banner": {
        "rate_limit": "NoneType",
        "cooldown": "NoneType"
      },
      "admin-capability-tooltip": {
        "rate_limit": "dict",
        "cooldown": "NoneType"
      }
    },
    "tiers": {}
  }
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/marketplaces/list-default-marketplaces`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "marketplaces": [
    {
      "id": "marketplace_01QRn9XAjzzeAokB5nPWVMxP",
      "name": "knowledge-work-plugins",
      "display_name": "Anthropic & Partners",
      "description": "anthropics/knowledge-work-plugins",
      "source": "github",
      "source_url": "https://github.com/anthropics/knowledge-work-plugins",
      "sync_status": "failed_content",
      "is_default": true,
      "created_at": "2026-03-05T16:10:46.943999Z",
      "updated_at": "2026-05-15T21:34:47.926941Z",
      "sync_started_at": null,
      "sync_ended_at": null,
      "last_synced_sha": null,
      "sync_errors": null,
      "auto_sync_on_push": true,
      "has_webhook_secret": "[REDACTED]",
      "default_plugin_installation_preference": null,
      "supports_per_org_default_preference": true,
      "is_visible_for_org": true
    }
  ]
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/mcp/v2/bootstrap`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'text/event-stream': 1}

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/memory/settings`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "enabled_saffron": true,
  "enabled_saffron_search": true,
  "enabled_melange": null
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/model_configs/claude-opus-4-7[1m]`

- Seen: 1 time(s)
- Statuses: {404: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "type": "error",
  "error": {
    "type": "not_found_error",
    "message": "Not found",
    "details": {
      "error_visibility": "user_facing"
    }
  },
  "request_id": "req_011CbACUdBB2f1pJ2o98TANW"
}
```

### `POST /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/notification/channels`

- Seen: 1 time(s)
- Statuses: {201: 1}
- MIME types: {'application/json': 1}
- Request shape:
```json
{
  "channel_type": "FCM",
  "registration_token": "[REDACTED]",
  "client_app_name": "claude-ai-web"
}
```
- Response shape:
```json
{
  "uuid": "3b899962-f14d-43aa-92de-bf2c840cbc52",
  "account_id": 2186565,
  "organization_id": 2204227,
  "channel_type": "FCM",
  "status": "ACTIVE",
  "registration_token": "[REDACTED]",
  "device_id": "50d6747d-efd2-4d78-94f4-d0af8636615a",
  "client_platform": "web_claude_ai",
  "client_app_name": "claude-ai-web",
  "last_token_refresh_time": "[REDACTED]",
  "last_successful_delivery_time": null
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/notification/preferences`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "account_id": 2186565,
  "organization_id": 2204227,
  "preferences": {
    "feature_preference": {
      "compass": {
        "enable_email": "bool",
        "enable_push": "bool"
      },
      "bogosort": {
        "enable_email": "bool",
        "enable_push": "bool"
      },
      "code_requires_action": null,
      "code_security_scan": null,
      "completion": {
        "enable_email": "bool",
        "enable_push": "bool"
      },
      "tool_notification": null,
      "project_sharing": null,
      "orbit_insight": null,
      "orbit_widget_refresh": null,
      "dispatch": {
        "enable_email": "NoneType",
        "enable_push": "bool"
      },
      "assist": null,
      "conway": null,
      "marketing": {
        "enable_email": "NoneType",
        "enable_push": "bool"
      }
    }
  },
  "push_reachability": {
    "has_active_channel": true,
    "platforms": [
      "ios"
    ],
    "most_recent_token_refresh": "[REDACTED]"
  }
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/overage_spend_limit`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "organization_uuid": "5fa81d9d-56e0-446b-9320-b3d07d0c7a61",
  "limit_type": "organization",
  "seat_tier": null,
  "account_uuid": null,
  "account_email": null,
  "account_name": null,
  "group_uuid": null,
  "group_name": null,
  "group_deleted": null,
  "org_service_name": null,
  "is_enabled": false,
  "monthly_credit_limit": 6000,
  "period": "monthly",
  "currency": "USD",
  "used_credits": 426,
  "used_credits_basis": null,
  "disabled_reason": null,
  "disabled_until": null,
  "out_of_credits": false,
  "discount_percent": null,
  "...": "5 more keys"
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/projects`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Query examples:
  - `include_harmony_projects=true&limit=30&starred=true`
- Response shape:
```json
[
  {
    "uuid": "5ccdd95c-a35b-45be-bb23-2c83f2c64915",
    "name": "Creative Songwriter Companion",
    "description": "Generates songs with detailed structure and style information.",
    "is_private": true,
    "creator": {
      "uuid": "47cef02f-d9a4-4fcf-8b60-569ff3f9b6a0",
      "full_name": "ET"
    },
    "is_starred": true,
    "is_starter_project": false,
    "is_harmony_project": false,
    "type": null,
    "subtype": null,
    "settings": {},
    "archiver": null,
    "archived_at": null,
    "created_at": "2024-06-26T04:10:51.099327Z",
    "updated_at": "2024-06-26T04:11:00.558590Z",
    "permissions": [
      "chat_project:owner:manage"
    ],
    "docs_count": null,
    "files_count": null
  }
]
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/subscription_details`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Query examples:
  - `cached=true`
- Response shape:
```json
{
  "plan_ending_before": null,
  "next_charge_date": "2026-06-01",
  "payment_method": {
    "brand": "mastercard",
    "country": "US",
    "last4": "6514",
    "type": "card"
  },
  "status": "active",
  "billing_interval": "monthly",
  "has_schedule": true,
  "has_discounts": false,
  "team_promo_ends_at": null,
  "gift_details": null,
  "payment_paused_until": null,
  "scheduled_downgrade": {
    "plan_type": "max_5x_monthly",
    "date": "2026-06-01T15:22:44",
    "billing_interval": "monthly",
    "base_price_in_minor_units": 10000,
    "currency": "usd"
  },
  "trial_end_ts": null,
  "seat_tier_quantities": null,
  "manual_pause_scheduled_at": null,
  "subscription_details_url": null,
  "subscription_payment_type": null,
  "test_clock_frozen_time": null,
  "eligible_for_past_due_cycle_reset": null,
  "currency": "USD"
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/sync/github/auth`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "is_authenticated": true,
  "user_login": null,
  "auth_source": "oauth",
  "ghe_connections": null
}
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/sync/settings`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
[
  {
    "type": "gcal",
    "enabled": true,
    "config": null
  }
]
```

### `GET /api/organizations/5fa81d9d-56e0-446b-9320-b3d07d0c7a61/usage`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "five_hour": {
    "utilization": 41.0,
    "resets_at": "2026-05-18T16:00:00.046361+00:00"
  },
  "seven_day": {
    "utilization": 35.0,
    "resets_at": "2026-05-19T14:00:01.046380+00:00"
  },
  "seven_day_oauth_apps": null,
  "seven_day_opus": null,
  "seven_day_sonnet": {
    "utilization": 2.0,
    "resets_at": "2026-05-19T14:00:01.046388+00:00"
  },
  "seven_day_cowork": null,
  "seven_day_omelette": {
    "utilization": 50.0,
    "resets_at": "2026-05-19T14:00:01.046397+00:00"
  },
  "tangelo": null,
  "iguana_necktie": null,
  "omelette_promotional": null,
  "extra_usage": {
    "is_enabled": false,
    "monthly_limit": null,
    "used_credits": null,
    "utilization": null,
    "currency": null,
    "disabled_reason": null
  }
}
```

### `GET /api/organizations/discoverable`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "organizations": [],
  "can_create_personal": true
}
```

### `POST /v1/code/github/batch-branch-status`

- Seen: 13 time(s)
- Statuses: {200: 13}
- MIME types: {'application/json': 13}
- Query examples:
  - `caller=ccd-sidebar`
  - `caller=epitaxy-repopr`
  - `caller=sessions-provider`
- Request shape:
```json
{
  "repo_branches": [
    {
      "repo": "etdofreshai/usage-api",
      "branch": "main"
    }
  ],
  "discover_session_prs": true,
  "session_ids": [
    "session_016S4pGgsuXDjLoKU41SGsun"
  ]
}
```
- Response shape:
```json
{
  "branch_statuses": [
    {
      "branch": "main",
      "branch_exists": true,
      "commits": 0,
      "has_changes": false,
      "has_session_binding": false,
      "repo": "etdofreshai/usage-api"
    }
  ]
}
```

### `POST /v1/code/sessions/cse_018EzFxwGZi4tFJV2GyTggCm/client/presence`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Request shape:
```json
{
  "client_id": "eb75d475-4e9d-4c09-bc5a-910589025966"
}
```
- Response shape:
```json
{
  "refresh_after_seconds": 20
}
```

### `POST /v1/session_ingress/session/session_018EzFxwGZi4tFJV2GyTggCm/git_proxy/compare`

- Seen: 3 time(s)
- Statuses: {200: 3}
- MIME types: {'application/json': 3}
- Request shape:
```json
{
  "owner": "Pixel-Dash-Studios",
  "repo": "knight-rider",
  "base": "develop",
  "head": "et/iterate-on-gadgets"
}
```
- Response shape:
```json
{
  "base_branch": "develop",
  "head_branch": "et/iterate-on-gadgets",
  "ahead_by": 8,
  "behind_by": 8,
  "total_commits": 8,
  "files": [
    {
      "filename": ".claude/scheduled_tasks.lock",
      "status": "added",
      "additions": 1,
      "deletions": 0,
      "changes": 1,
      "patch": "string",
      "previous_filename": null
    }
  ],
  "diff_url": "string",
  "commits": [
    {
      "sha": "b483f21e72fbc3e35c08576aea16c9bd236edb09",
      "short_sha": "b483f21",
      "subject": "Laser: update side condition to AnyBehind (back/back-left/back-right)",
      "author_name": "ETdoFresh",
      "author_email": "etdofresh@gmail.com",
      "date": 1778884333
    }
  ],
  "merge_base": "c7bfa34a5fded3b01b301db3c6124c14aade4ee7"
}
```

### `GET /v1/sessions`

- Seen: 16 time(s)
- Statuses: {200: 16}
- MIME types: {'application/json': 16}
- Query examples:
  - `after_id=session_011WZhRuahRdo5ctmRcafrhN`
  - `after_id=session_0138MVW2BQvPsWqxQ13dDub9`
  - `after_id=session_018t52CcsJebiUXUn5ijXEkB`
  - `after_id=session_019hNkxwgEZWKsmX9gdrX76g`
  - `after_id=session_01Bc9W7zT9C5V3yYtvkkcj8t`
- Response shape:
```json
{
  "data": [
    {
      "active_mount_paths": [],
      "connection_status": "connected",
      "created_at": "2026-05-18T14:24:42.781662Z",
      "environment_id": "",
      "environment_kind": "bridge",
      "external_metadata": {
        "current_branches": "dict"
      },
      "id": "session_018EzFxwGZi4tFJV2GyTggCm",
      "metadata": {},
      "session_context": {
        "allowed_tools": "list",
        "append_system_prompt": "str",
        "cwd": "str",
        "disallowed_tools": "list",
        "environment_variables": "dict",
        "mcp_config": "dict",
        "model": "str",
        "outcomes": "list",
        "sources": "list"
      },
      "session_status": "idle",
      "tags": [
        "str"
      ],
      "title": "KR Work",
      "type": "internal_session",
      "unread": true,
      "updated_at": "2026-05-18T14:32:55.000102Z"
    }
  ],
  "first_id": "session_018EzFxwGZi4tFJV2GyTggCm",
  "has_more": true,
  "last_id": "session_018t52CcsJebiUXUn5ijXEkB"
}
```

### `GET /v1/sessions/session_018EzFxwGZi4tFJV2GyTggCm`

- Seen: 11 time(s)
- Statuses: {200: 11}
- MIME types: {'application/json': 11}
- Response shape:
```json
{
  "active_mount_paths": [],
  "connection_status": "connected",
  "created_at": "2026-05-18T14:24:42.781662Z",
  "environment_id": "",
  "environment_kind": "bridge",
  "external_metadata": {
    "current_branches": {
      "Pixel-Dash-Studios/knight-rider": "et/iterate-on-gadgets"
    }
  },
  "id": "session_018EzFxwGZi4tFJV2GyTggCm",
  "metadata": {},
  "session_context": {
    "allowed_tools": [],
    "append_system_prompt": "string",
    "cwd": "D:\\Projects\\knight-rider",
    "disallowed_tools": [],
    "environment_variables": {},
    "mcp_config": {
      "mcpServers": {
        "github": "dict"
      }
    },
    "model": "claude-opus-4-7[1m]",
    "outcomes": [
      {
        "git_info": "dict",
        "type": "str"
      }
    ],
    "sources": [
      {
        "allow_unrestricted_git_push": "bool",
        "revision": "str",
        "sparse_checkout_paths": "list",
        "type": "str",
        "url": "str"
      }
    ]
  },
  "session_status": "idle",
  "tags": [
    "remote-control-sdk"
  ],
  "title": "KR Work",
  "type": "internal_session",
  "unread": true,
  "updated_at": "2026-05-18T14:32:55.000102Z"
}
```

### `GET /v1/sessions/session_018EzFxwGZi4tFJV2GyTggCm/events`

- Seen: 2 time(s)
- Statuses: {200: 2}
- MIME types: {'application/json': 2}
- Query examples:
  - `limit=1000`
  - `limit=1000&after_id=7b85811c-46fc-4e48-8481-d08b000e683f`
- Response shape:
```json
{
  "data": [
    {
      "created_at": "2026-05-18T14:24:43.193554Z",
      "historical": true,
      "message": {
        "content": "list",
        "diagnostics": "NoneType",
        "id": "str",
        "model": "str",
        "role": "str",
        "stop_details": "NoneType",
        "stop_reason": "str",
        "stop_sequence": "NoneType",
        "type": "str",
        "usage": "dict"
      },
      "parent_tool_use_id": null,
      "session_id": "cse_018EzFxwGZi4tFJV2GyTggCm",
      "type": "assistant",
      "uuid": "2705d604-627a-49e4-b8da-441e1b9fc9c1"
    }
  ],
  "first_id": "2705d604-627a-49e4-b8da-441e1b9fc9c1",
  "has_more": false,
  "last_id": "7b85811c-46fc-4e48-8481-d08b000e683f"
}
```

### `POST /v1/sessions/session_018EzFxwGZi4tFJV2GyTggCm/events`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Request shape:
```json
{
  "events": [
    {
      "type": "user",
      "uuid": "e69c7302-87c7-4947-a0dd-da938546252a",
      "session_id": "session_018EzFxwGZi4tFJV2GyTggCm",
      "parent_tool_use_id": null,
      "message": {
        "role": "str",
        "content": "string"
      }
    }
  ]
}
```
- Response shape:
```json
{
  "events": [
    {
      "client_platform": "web_claude_ai",
      "message": {
        "content": "string",
        "role": "str"
      },
      "parent_tool_use_id": null,
      "session_id": "session_018EzFxwGZi4tFJV2GyTggCm",
      "type": "user",
      "uuid": "e69c7302-87c7-4947-a0dd-da938546252a"
    }
  ]
}
```

### `GET /v1/sessions/session_018EzFxwGZi4tFJV2GyTggCm/share-status`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'application/json': 1}
- Response shape:
```json
{
  "current_last_event_id": "206",
  "shares": [],
  "sharing_settings": null
}
```

### `GET /v1/sessions/watch`

- Seen: 1 time(s)
- Statuses: {200: 1}
- MIME types: {'text/event-stream': 1}

### `GET /v1/sessions/ws/session_018EzFxwGZi4tFJV2GyTggCm/subscribe`

- Seen: 1 time(s)
- Statuses: {101: 1}
- MIME types: {'x-unknown': 1}
- Query examples:
  - `organization_uuid=5fa81d9d-56e0-446b-9320-b3d07d0c7a61`

## Newest connected sessions seen in HAR

- `2026-05-18T14:33:09.125604Z` `connected` `session_01N2PvqteqjdTjetTjmDiDXJ` — wolf3d-oversight — tags=['remote-control-repl'] branch={'etdofreshai/workspace-sync': 'main'}
- `2026-05-18T14:32:55.000102Z` `connected` `session_018EzFxwGZi4tFJV2GyTggCm` — KR Work — tags=['remote-control-sdk'] branch={'Pixel-Dash-Studios/knight-rider': 'et/iterate-on-gadgets'}
- `2026-05-18T14:32:24.977070Z` `connected` `session_018MtxqyixtHFV1utjhidCAR` — ccrc desktop — tags=['remote-control-repl'] branch=None
- `2026-05-18T14:06:09.734974Z` `connected` `session_01V8ZivuDdcCocGtD8Y6cXyo` — KR Work — tags=['remote-control-repl'] branch={'Pixel-Dash-Studios/knight-rider': 'et/iterate-on-gadgets'}
- `2026-05-18T02:29:27.210622Z` `connected` `session_01QjgvimrCtXZHAM6wABzbsQ` — usage-api — tags=['remote-control-sdk'] branch={'etdofreshai/usage-api': 'main'}
- `2026-05-18T02:23:56.601831Z` `connected` `session_0154rzMxSauSRr2C21uioYAf` — ccrc-smoke-2 — tags=['remote-control-sdk'] branch={'etdofreshai/workspace-sync': 'main'}
- `2026-05-18T02:18:52.961584Z` `connected` `session_01GiNtscfcNSP6kgVYfEqTCr` — ccrc-smoke — tags=['remote-control-sdk'] branch={'etdofreshai/workspace-sync': 'main'}
- `2026-05-17T23:23:51.550621Z` `connected` `session_01F26bL22jf5vjTTSiWC5vxH` — 5115e44cc61a-breezy-adleman — tags=['remote-control-sdk'] branch={'etdofreshai/workspace-sync': 'main'}
- `2026-05-17T06:46:24.466932Z` `connected` `session_015PULuFeYLrLSXEyf3ZXc93` — etzevox2-snazzy-swing — tags=['remote-control-repl'] branch=None
- `2026-05-17T03:46:40.160194Z` `connected` `session_01DnrLRMF3rrnnnw3jjSk5wF` — etzmacminim2-lan-lucky-lighthouse — tags=['remote-control-auto'] branch=None
- `2026-05-17T03:35:36.858643Z` `connected` `session_014YL1QyEiSkSYnMdmmo85Up` — etzmacminim2-lan-gentle-castle — tags=['remote-control-auto'] branch=None
- `2026-05-17T03:18:14.502691Z` `connected` `session_01GD5JmjiYEs8jjFEw1fgdKm` — HTML all our progress so far — tags=['remote-control-auto'] branch=None
- `2026-05-17T02:48:51.475379Z` `connected` `session_01N3iKjtp3ymsjZo59EHPiaU` — Check context length and environment variables — tags=['remote-control-auto'] branch=None
- `2026-05-17T01:25:37.150075Z` `connected` `session_01HKSyRfoNNa9ijSRgdt2YRT` — Troubleshoot Fire Cube TV network connectivity — tags=[] branch={'etdofreshai/workspace-sync': 'main'}
- `2026-05-17T00:54:01.699832Z` `connected` `session_01JEUpMj5wz3kT8aocNTrosY` — etzmacminim2-lan-replicated-rainbow — tags=['remote-control-auto'] branch=None
- `2026-05-17T00:48:32.827512Z` `connected` `session_01AVeprVQidJtcDChdzLgZk1` — etzmacminim2-lan-humble-cloud — tags=['remote-control-auto'] branch=None
- `2026-05-16T20:31:47.795970Z` `connected` `session_01NHmjHsTzrxMCDtSfV8J4Da` — Code session interrupted — tags=['remote-control-auto'] branch=None
- `2026-05-16T20:31:17.501351Z` `connected` `session_01JgZzU3erphNdeveSMrGSf4` — etzmacminim2-lan-resilient-dawn — tags=['remote-control-auto'] branch={'etdofreshai/workspace-sync': 'main'}
- `2026-05-16T20:30:16.915548Z` `connected` `session_01HKaKS9Q5ntQu462rxQmeX9` — etzmacminim2-lan-golden-wilkinson — tags=['remote-control-auto'] branch={'etdofreshai/workspace-sync': 'main'}
- `2026-05-16T19:58:59.780957Z` `connected` `session_01VZSsu8r3JfuiWk495gzUt6` — Review claude-code-remote-manager action history — tags=[] branch={'etdofreshai/workspace-sync': 'main'}

## CCRC server API surface

These are the local CCRC endpoints, separate from Claude.ai APIs:

- `GET /healthz` — Public health check
- `GET /help` — Human-readable docs/help
- `GET /api/help` — JSON endpoint inventory
- `GET /api/clients` — List connected/known clients
- `GET /api/clients/:name` — Inspect one client
- `GET /api/clients/:name/sessions` — List known and pinned sessions
- `POST /api/clients/:name/sessions/list` — Ask client to refresh local sessions
- `POST /api/clients/:name/sessions/new` — Start a new local Claude Code remote-control session
- `POST /api/clients/:name/sessions/resume` — Resume/bind an existing local Claude Code session
- `POST /api/clients/:name/sessions/:sessionId/message` — Send a message through the connected client
- `POST /api/clients/:name/sessions/:sessionId/stop` — Stop/disable remote control for a local session
- `POST /api/clients/:name/disconnect` — Ask client to disconnect
- `POST /api/agent/connect` — Client connect endpoint
- `POST /api/agent/sessions` — Client reports local sessions
- `GET /api/agent/poll` — Client long-polls for commands
- `POST /api/agent/ack` — Client acknowledges command result
- `POST /api/agent/disconnect` — Client disconnect notification
