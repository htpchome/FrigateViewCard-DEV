export function parseRealtimeAlertMessage({ host, msg }) {
  const incomingCam = host?._extractRealtimeMessageCamera(msg);
  if (!incomingCam) return null;

  const cam = host?._cameraEntityForIncomingCamera(incomingCam);
  if (!cam) return null;

  const severity = host?._extractRealtimeMessageSeverity(msg);
  const type = String(msg?.type || "")
    .trim()
    .toLowerCase();

  return { cam, severity, type };
}
