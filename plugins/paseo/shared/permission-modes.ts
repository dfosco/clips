export type ProviderPermissionMode = {
  id: string;
  label: string;
  description?: string;
  colorTier?: string;
};

export const FULL_ACCESS_MODE = "full-access";
export const RESTRICTED_MODE = "restricted";

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

export function fullAccessMode(modes: readonly ProviderPermissionMode[]): ProviderPermissionMode | undefined {
  return modes.find((mode) => {
    const value = (mode.id + " " + mode.label).toLowerCase();
    return /\b(full[- ]access|bypass|unrestricted)\b/.test(value);
  }) ?? modes.find((mode) => mode.colorTier === "dangerous");
}

export function restrictedAccessMode(
  modes: readonly ProviderPermissionMode[],
  defaultModeId?: string | null,
): ProviderPermissionMode | undefined {
  const approvalMode = modes.find((mode) => {
    const id = normalized(mode.id);
    const label = normalized(mode.label);
    return id === "auto" || id === "ask" ||
      /^(default-permissions|restricted|approval|workspace-write)$/.test(id) ||
      /default-permissions|restricted-access|approval-flow/.test(label);
  });
  if (approvalMode && approvalMode.colorTier !== "dangerous") return approvalMode;

  const defaultMode = modes.find((mode) => mode.id === defaultModeId);
  if (defaultMode && defaultMode.colorTier !== "dangerous") return defaultMode;
  return modes.find((mode) => mode.colorTier === "moderate") ??
    modes.find((mode) => mode.colorTier === "safe");
}

export function resolvePermissionMode(
  requested: string,
  modes: readonly ProviderPermissionMode[],
  defaultModeId?: string | null,
): ProviderPermissionMode | undefined {
  const direct = modes.find((mode) => mode.id === requested);
  if (direct) return direct;
  if (requested === FULL_ACCESS_MODE) return fullAccessMode(modes);
  if (requested === RESTRICTED_MODE) return restrictedAccessMode(modes, defaultModeId);
  return undefined;
}

export function fullAccessModeId(modes: readonly ProviderPermissionMode[]): string | undefined {
  return fullAccessMode(modes)?.id;
}

export function restrictedAccessModeId(
  modes: readonly ProviderPermissionMode[],
  defaultModeId?: string | null,
): string | undefined {
  return restrictedAccessMode(modes, defaultModeId)?.id;
}
