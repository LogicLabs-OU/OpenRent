import { sf, fail, localPath } from '#lib/server/api.ts';
import type { PageServerLoad } from './$types';

/** The signing page (FR-DOC-5): the private link token is the proof; the emailed code confirms the person. */
export const load: PageServerLoad = async (event) => {
  const token = event.params.token;
  try {
    const r = await sf(event, `/signatures/${encodeURIComponent(token)}`);
    return { sign: { ...r, token, document_url: localPath(event, `/sign/${encodeURIComponent(token)}/document`) } };
  } catch (e) {
    fail(e);
  }
};
