# PII Field Classification (M7)

This document classifies common response fields by whether they are likely to be personally identifiable information (PII).

Classification here is conservative. Treat anything that can identify a natural person directly or indirectly as PII.

## LinkedIn: `profile`

- `full_name`: PII
- `headline`: potentially PII (often job title + company)
- `location`: potentially PII (city/region)
- `about`: potentially PII (freeform bio can include contact details)
- `follower_count`: non-PII (aggregate metric)
- `handle`: potentially PII (profile identifier)
- `profile_url`: potentially PII (identifier)

## X: `profile`

- `display_name`: potentially PII
- `handle`: potentially PII
- `bio`: potentially PII (freeform)
- `location`: potentially PII
- `follower_count`: non-PII
- `following_count`: non-PII
- `post_count`: non-PII
- `profile_url`: potentially PII

## Discord: `server_metadata`

- `server_name`: usually non-PII (depends on server)
- `description`: potentially PII (freeform)
- `invite_code`: potentially PII (access identifier)
- `invite_url`: potentially PII (access identifier)
- `member_count`: non-PII
- `online_count`: non-PII

## Notes

- Freeform fields (bio/about/description) can contain emails/phones. Treat them as potentially PII.
- Logs and stored artifacts should avoid recording full targets/responses unless strictly required.

