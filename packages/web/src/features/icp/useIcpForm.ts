import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createEmptyIcpConfig,
  createExampleIcpConfig,
  detailsByPath,
  icpConfigSchema,
  zodErrorToDetails,
  type IcpConfig,
  type IcpProfileDto,
  type IcpProfileSummaryDto,
} from '@pursuit/shared';
import { icpApi, type ClientError } from '../../api/client.js';

export type FormMode = 'create' | 'edit';
export type ListStatus = 'loading' | 'ready' | 'error';
export type FormStatus = 'idle' | 'loading' | 'submitting' | 'deleting';

export interface EditTarget {
  id: string;
  name: string;
  version: number;
}

export type SectionKey = Exclude<keyof IcpConfig, 'schemaVersion' | 'scoringWeights'>;

export interface RecordMeta {
  status: 'ACTIVE' | 'INACTIVE';
  changeReason: string;
}

const EMPTY_META: RecordMeta = { status: 'ACTIVE', changeReason: '' };

/**
 * Server error details are prefixed with `config.` because the payload nests
 * the configuration; client-side validation runs against the configuration
 * itself. Stripping the prefix puts both in the same key space, so a field
 * renders the same message whichever side produced it.
 */
function stripConfigPrefix(path: string): string {
  return path.startsWith('config.') ? path.slice('config.'.length) : path;
}

export interface UseIcpForm {
  mode: FormMode;
  status: FormStatus;
  draft: IcpConfig;
  meta: RecordMeta;
  editTarget: EditTarget | null;
  errors: Record<string, string[]>;
  /** Errors that belong to no single field (API level, cross-section). */
  formError: ClientError | null;
  successMessage: string | null;
  dirty: boolean;
  profiles: IcpProfileSummaryDto[];
  /** Load state of the ICP list, so the sidebar can show a skeleton. */
  listStatus: ListStatus;
  listError: ClientError | null;
  errorsFor: (path: string) => string[] | undefined;
  updateSection: <K extends SectionKey>(key: K, patch: Partial<IcpConfig[K]>) => void;
  updateMeta: (patch: Partial<RecordMeta>) => void;
  /** Resolves with the saved ICP's id, or null when nothing was saved. */
  submit: () => Promise<string | null>;
  reset: () => void;
  loadExample: () => void;
  startCreate: () => void;
  startEdit: (id: string) => Promise<void>;
  /** Resolves true when the ICP was removed. */
  deleteProfile: (id: string) => Promise<boolean>;
  refreshProfiles: () => Promise<void>;
}

export function useIcpForm(): UseIcpForm {
  const [draft, setDraft] = useState<IcpConfig>(() => createEmptyIcpConfig());
  const [meta, setMeta] = useState<RecordMeta>(EMPTY_META);
  const [mode, setMode] = useState<FormMode>('create');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<ClientError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<IcpProfileSummaryDto[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>('loading');
  const [listError, setListError] = useState<ClientError | null>(null);
  const [dirty, setDirty] = useState(false);

  /** Snapshot the form was loaded with, used by reset. */
  const baseline = useRef<{ config: IcpConfig; meta: RecordMeta }>({
    config: createEmptyIcpConfig(),
    meta: EMPTY_META,
  });

  const refreshProfiles = useCallback(async () => {
    const result = await icpApi.list();
    if (result.ok) {
      setProfiles(result.data.items);
      setListError(null);
      setListStatus('ready');
    } else {
      setListError(result.error);
      setListStatus('error');
    }
  }, []);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  const applyBaseline = useCallback((config: IcpConfig, nextMeta: RecordMeta) => {
    baseline.current = { config: structuredClone(config), meta: { ...nextMeta } };
    setDraft(structuredClone(config));
    setMeta({ ...nextMeta });
    setErrors({});
    setFormError(null);
    setDirty(false);
  }, []);

  const updateSection = useCallback(
    <K extends SectionKey>(key: K, patch: Partial<IcpConfig[K]>) => {
      setDraft((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
      setDirty(true);
      setSuccessMessage(null);
    },
    [],
  );

  const updateMeta = useCallback((patch: Partial<RecordMeta>) => {
    setMeta((current) => ({ ...current, ...patch }));
    setDirty(true);
    setSuccessMessage(null);
  }, []);

  const startCreate = useCallback(() => {
    setMode('create');
    setEditTarget(null);
    setSuccessMessage(null);
    applyBaseline(createEmptyIcpConfig(), EMPTY_META);
  }, [applyBaseline]);

  const loadExample = useCallback(() => {
    setDraft(createExampleIcpConfig());
    setErrors({});
    setFormError(null);
    setSuccessMessage(null);
    setDirty(true);
  }, []);

  const startEdit = useCallback(
    async (id: string) => {
      setStatus('loading');
      setSuccessMessage(null);
      const result = await icpApi.get(id);
      setStatus('idle');

      if (!result.ok) {
        setFormError(result.error);
        return;
      }

      const profile: IcpProfileDto = result.data;
      setMode('edit');
      setEditTarget({ id: profile.id, name: profile.name, version: profile.version });
      applyBaseline(profile.config, {
        status: profile.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        changeReason: '',
      });
    },
    [applyBaseline],
  );

  const reset = useCallback(() => {
    setSuccessMessage(null);
    applyBaseline(baseline.current.config, baseline.current.meta);
  }, [applyBaseline]);

  const submit = useCallback(async (): Promise<string | null> => {
    setSuccessMessage(null);
    setFormError(null);

    // Validate with the same schema the API uses before making a request.
    const parsed = icpConfigSchema.safeParse(draft);
    if (!parsed.success) {
      const details = zodErrorToDetails(parsed.error);
      setErrors(detailsByPath(details));
      setFormError({
        code: 'VALIDATION_ERROR',
        message: `Fix ${details.length} validation ${details.length === 1 ? 'issue' : 'issues'} before submitting.`,
        details,
      });
      return null;
    }

    setErrors({});
    setStatus('submitting');
    const payload = {
      config: parsed.data,
      status: meta.status,
      ...(meta.changeReason.trim().length > 0 ? { changeReason: meta.changeReason.trim() } : {}),
    };
    const result =
      mode === 'edit' && editTarget
        ? await icpApi.update(editTarget.id, payload)
        : await icpApi.create(payload);
    setStatus('idle');

    if (!result.ok) {
      setFormError(result.error);
      setErrors(
        detailsByPath(
          result.error.details.map((detail) => ({ ...detail, path: stripConfigPrefix(detail.path) })),
        ),
      );
      return null;
    }

    const saved = result.data;
    setMode('edit');
    setEditTarget({ id: saved.id, name: saved.name, version: saved.version });
    applyBaseline(saved.config, {
      status: saved.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      changeReason: '',
    });
    setSuccessMessage(
      mode === 'edit'
        ? `Saved "${saved.name}" as version ${saved.version}.`
        : `Created "${saved.name}" (version ${saved.version}).`,
    );
    await refreshProfiles();
    return saved.id;
  }, [applyBaseline, draft, editTarget, meta, mode, refreshProfiles]);

  /**
   * Removing the ICP does not reset the form here: the caller navigates away
   * from the deleted record, and re-entering `new` or `edit` re-seeds the
   * draft. Resetting here as well would clear the success message it just set.
   */
  const deleteProfile = useCallback(
    async (id: string): Promise<boolean> => {
      setStatus('deleting');
      setFormError(null);
      const result = await icpApi.remove(id);
      setStatus('idle');

      if (!result.ok) {
        setFormError(result.error);
        return false;
      }
      setSuccessMessage('ICP deleted.');
      await refreshProfiles();
      return true;
    },
    [refreshProfiles],
  );

  const errorsFor = useCallback((path: string) => errors[path], [errors]);

  return useMemo(
    () => ({
      mode,
      status,
      draft,
      meta,
      editTarget,
      errors,
      formError,
      successMessage,
      dirty,
      profiles,
      listStatus,
      listError,
      errorsFor,
      updateSection,
      updateMeta,
      submit,
      reset,
      loadExample,
      startCreate,
      startEdit,
      deleteProfile,
      refreshProfiles,
    }),
    [
      deleteProfile,
      dirty,
      draft,
      editTarget,
      errors,
      errorsFor,
      formError,
      listError,
      listStatus,
      loadExample,
      meta,
      mode,
      profiles,
      refreshProfiles,
      reset,
      startCreate,
      startEdit,
      status,
      submit,
      successMessage,
      updateMeta,
      updateSection,
    ],
  );
}
