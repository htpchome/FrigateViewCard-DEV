export const CAMERA_SUSPEND_ACCESS = Object.freeze({
  adminOnly: "admin_only",
  everyone: "everyone",
  disabled: "disabled",
});

export const DEFAULT_CAMERA_SUSPEND_ACCESS =
  CAMERA_SUSPEND_ACCESS.adminOnly;

export const normalizeCameraSuspendAccess = (value) => {
  if (value === CAMERA_SUSPEND_ACCESS.everyone) {
    return CAMERA_SUSPEND_ACCESS.everyone;
  }
  if (value === CAMERA_SUSPEND_ACCESS.disabled) {
    return CAMERA_SUSPEND_ACCESS.disabled;
  }
  return DEFAULT_CAMERA_SUSPEND_ACCESS;
};

export const canUserManageCameraSuspension = ({
  access,
  user,
} = {}) => {
  const normalizedAccess = normalizeCameraSuspendAccess(access);
  if (normalizedAccess === CAMERA_SUSPEND_ACCESS.disabled) return false;
  return (
    normalizedAccess === CAMERA_SUSPEND_ACCESS.everyone ||
    user?.is_admin === true
  );
};
