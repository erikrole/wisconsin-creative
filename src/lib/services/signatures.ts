// Signature collection services, split by stage. This module keeps the
// original import path for callers.

export {
  listSignatureCollections,
  getSignatureCollection,
  getSignatureMemberCaptureBootstrap,
  archiveSignatureCollection,
  restoreSignatureCollection,
  deleteSignatureCollection,
  resetSignatureCollection,
} from "./signature-collections";
export {
  createSignatureRosterPreview,
  applySignatureRosterSnapshot,
  createAdHocSignatureMember,
  syncSignatureCreativeStaff,
  updateSignaturePenSettings,
  updateSignatureMemberRequired,
  removeSignatureMemberFromRoster,
  addSignatureTeamPlayer,
  moveSignatureCapture,
} from "./signature-roster";
export { removeSignatureCapture, saveSignatureCapture } from "./signature-captures";
export {
  getReadySignatureArtifact,
  signatureArtifactFilename,
  getSignatureCollectionZip,
  cleanupPendingSignatureArtifacts,
} from "./signature-artifacts";
