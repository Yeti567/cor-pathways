export function canViewCompletedSubmissionPrint({
  canUseMonitor,
  signedByUser,
  submittedByUser,
}: {
  canUseMonitor: boolean;
  signedByUser: boolean;
  submittedByUser: boolean;
}) {
  return canUseMonitor || submittedByUser || signedByUser;
}
