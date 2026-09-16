# Deployment findings

## pCloud

The official pCloud API exposes an `uploadfile` endpoint that accepts multipart/form-data uploads and accepts files generally. pCloud advertises up to 10 GB of free storage. pCloud is an object/file storage provider; it does not run the maagarim Node/Express web server, PostgreSQL database, Redis-compatible queue, or BullMQ worker. A pCloud integration would therefore store completed or temporary upload files but would require a pCloud OAuth/API credential and additional application code. Source: https://docs.pcloud.com/methods/file/uploadfile.html and https://www.pcloud.com/

## Render Free

Render's official free-tier documentation says free web services, Postgres databases, and Key Value instances are available, but explicitly states that free instances have important limitations and should not be used for production applications. The free Postgres instance created for this project reports an expiration one month after creation. The free Key Value instance has persistence disabled. Free service sleep/usage limits and ephemeral filesystem behavior make it unsuitable for a permanent 2GB upload service without external persistent storage and a recovery strategy. Source: https://render.com/docs/free

## Current Render resources

Workspace: tea-dak6inek1f9s73ejvd50 (My Workspace)
Postgres: maagarim-db, id dpg-dak6kup594qs738j0geg-a, free, Frankfurt, expires 2026-10-14.
Key Value: maagarim-redis, id red-dak6l50ae00c73fsmsj0, free, Frankfurt, persistence off.

## Recommendation

For strictly zero cost, keep Render free for a demo/staging deployment and use pCloud only as an optional file store after adding secure API/OAuth integration. This does not provide a reliable permanent production service. A genuinely permanent deployment requires either paid persistent infrastructure or a user-owned always-on machine/VPS; pCloud alone cannot replace the runtime and databases.

## pCloud API integration details

The official pCloud developer documentation states that API calls must target `api.pcloud.com` for US accounts or `eapi.pcloud.com` for European accounts, and that OAuth authorization determines the correct host. It also documents file access by file ID/folder ID and notes that implementations must support 64-bit IDs and byte sizes. The planned integration should keep the pCloud token server-side and select the API host through `PCLOUD_API_HOST` rather than hardcoding the wrong region. Source: https://docs.pcloud.com/
