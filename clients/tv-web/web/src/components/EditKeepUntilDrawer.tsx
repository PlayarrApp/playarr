import { Drawer } from "./shell";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { DownloadKeepUntilPolicy } from "../lib/downloadsDb";
import type { DownloadOptionsResponse } from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { formatBytes, formatEstimatedBytes } from "../lib/formatBytes";
import { Select } from "./ui";
import {
  KeepUntilPicker,
  keepUntilPolicyFromState,
  keepUntilStateFromPolicy,
  type KeepUntilState,
} from "./KeepUntilPicker";

/**
 * Edit drawer for existing downloads: keep-until, and quality. Changing quality re-converts through a new ticket (the
 * caller does that), so the quality section lists the server's options for the first record's media file and is
 * absent when they cannot be loaded (offline).
 */
export function EditKeepUntilDrawer({
  title,
  keepUntil,
  qualityId,
  mediaFileId,
  onClose,
  onConfirm,
  busy = false,
}: {
  title: string;
  keepUntil: DownloadKeepUntilPolicy;
  /** The current quality of the first record; selecting another one asks for a re-conversion. */
  qualityId: string;
  mediaFileId: string;
  onClose: () => void;
  onConfirm: (keepUntil: DownloadKeepUntilPolicy, quality: { qualityId: string; qualityLabel: string } | null) => void;
  busy?: boolean;
}) {
  const { t } = useLanguage();
  const client = useApiClient();
  const [state, setState] = useState<KeepUntilState>(() => keepUntilStateFromPolicy(keepUntil));
  const [options, setOptions] = useState<DownloadOptionsResponse["options"]>([]);
  const [selected, setSelected] = useState(qualityId);

  useEffect(() => {
    let cancelled = false;
    client
      .getDownloadOptions(mediaFileId)
      .then((response) => {
        if (!cancelled) setOptions(response.options);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, mediaFileId]);

  const chosen = options.find((option) => option.id === selected);
  const changed = chosen !== undefined && selected !== qualityId;

  return (
    <Drawer
      className="tv-playback-settings-drawer download-quality-drawer"
      ariaLabel={t("pages.downloads.editKeepUntilDialogLabel", { title })}
      kicker={t("components.downloadQualityDrawer.kicker")}
      title={title}
      closeLabel={t("components.downloadQualityDrawer.close")}
      onClose={onClose}
    >
      {options.length > 0 ? (
        <section>
          <h3>{t("components.downloadQualityDrawer.qualityHeading")}</h3>
          <Select
            ariaLabel={t("components.downloadQualityDrawer.qualityHeading")}
            value={selected}
            onChange={setSelected}
            options={options.map((option) => ({
              value: option.id,
              label: option.label,
              hint: option.size_is_estimate ? formatEstimatedBytes(option.estimated_size_bytes) : formatBytes(option.estimated_size_bytes),
            }))}
          />
          {changed ? <p className="download-quality-drawer-hint">{t("pages.downloads.changeQualityHint")}</p> : null}
        </section>
      ) : null}

      <KeepUntilPicker state={state} onChange={setState} />

      <div className="tv-playback-settings-actions">
        <button type="button" onClick={onClose} disabled={busy}>
          {t("components.downloadQualityDrawer.cancel")}
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={busy}
          onClick={() =>
            onConfirm(keepUntilPolicyFromState(state), changed && chosen ? { qualityId: chosen.id, qualityLabel: chosen.label } : null)
          }
        >
          {t("pages.downloads.save")}
        </button>
      </div>
    </Drawer>
  );
}
