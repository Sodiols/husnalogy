/* ==========================================================================
   Product media limits match what the application actually accepts.

   The upload route advertised 120 MB videos while every admin request is
   streamed into memory with a 35 MB cap (lib/uploads/admin-media.ts). The
   application limit is now 30 MB per video, 15 MB per image, 35 MB per
   request; the product-videos bucket enforces the same 30 MB, so a direct
   Storage write cannot exceed it either. Raising the limit later requires a
   direct-to-Storage upload flow, not a larger in-memory body.
   ========================================================================== */

update storage.buckets set file_size_limit = 31457280 where id = 'product-videos';
