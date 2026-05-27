/**
 * Cloudflare R2 client for Catch Comics cover image storage.
 *
 * R2 is S3-compatible — we use @aws-sdk/client-s3 with a custom endpoint.
 * Bucket: catchcomics-covers
 * Region: auto (Cloudflare manages this)
 */

import { S3Client } from '@aws-sdk/client-s3'

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

export const R2_BUCKET     = process.env.R2_BUCKET_NAME!
export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '')
