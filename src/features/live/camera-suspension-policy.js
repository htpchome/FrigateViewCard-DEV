export const CAMERA_SUSPEND_ACCESS = Object.freeze({
  adminOnly: "admin_only",
  everyone: "everyone",
});

export const DEFAULT_CAMERA_SUSPEND_ACCESS =
  CAMERA_SUSPEND_ACCESS.adminOnly;

export const normalizeCameraSuspendAccess = (value) =>
  value === CAMERA_SUSPEND_ACCESS.everyone
    ? CAMERA_SUSPEND_ACCESS.everyone
    : DEFAULT_CAMERA_SUSPEND_ACCESS;

export const canUserManageCameraSuspension = ({
  access,
  user,
} = {}) =>
  normalizeCameraSuspendAccess(access) === CAMERA_SUSPEND_ACCESS.everyone ||
  user?.is_admin === true;
