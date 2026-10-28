/**
 * Stand-ins for Documenso and DocuSign that enforce what each service requires, for testing the signing
 * plugins without real accounts (FR-DOC-6). They need nothing but Node.
 */
export { startDocumensoFake, type DocumensoFake, type DocumensoEnvelope } from './documenso.ts';
export { startDocuSignFake, type DocuSignFake, type DocuSignEnvelope } from './docusign.ts';
export { serve, multipart, type Server } from './server.ts';
