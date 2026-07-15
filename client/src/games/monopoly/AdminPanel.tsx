import { useEffect, useState, type ReactNode } from 'react';
import type { BoardEdition, GroupId } from '@shared/types';
import { GROUP_LABELS, GROUP_ORDER } from '@shared/boards';
import { api } from '../../net/socket';
import { useStore } from '../../state/store';
import { Modal } from './Dialogs';

/**
 * Admin-Bereich: Editionen anlegen/bearbeiten – Straßennamen, Gruppenfarben,
 * Brettfarbe, Währung und Bilder (als Data-URLs, serverseitig größenbegrenzt).
 */

async function fileToDataUrl(file: File, maxDim = 640): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const keepPng = file.type === 'image/png' && file.size < 150_000;
    const url = keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.82);
    return url.length <= 390_000 ? url : canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return null;
  }
}

function ImageUpload({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (v: string | undefined) => void;
}) {
  const addToast = useStore((s) => s.addToast);
  return (
    <div className="image-upload">
      {value && <img src={value} alt="" />}
      <label className="btn small">
        {value ? '🖼 Ändern' : `🖼 ${label}`}
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const url = await fileToDataUrl(file);
            if (!url) return addToast('error', 'Bild konnte nicht verarbeitet werden.');
            onChange(url);
          }}
        />
      </label>
      {value && (
        <button className="btn ghost small" onClick={() => onChange(undefined)}>
          ✕ Entfernen
        </button>
      )}
    </div>
  );
}

function TileGroupSection({
  label,
  color,
  neutral,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  color?: string;
  neutral?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`tile-group${isOpen ? ' open' : ''}`}>
      <button
        type="button"
        className={`tile-group-head${neutral ? ' neutral' : ''}`}
        style={color ? { background: color } : undefined}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className="tile-group-chevron">{isOpen ? '▾' : '▸'}</span>
        <span>{label}</span>
      </button>
      {isOpen && <div className="tile-rows">{children}</div>}
    </div>
  );
}

export function AdminPanel() {
  const closeDialog = useStore((s) => s.closeDialog);
  const editions = useStore((s) => s.editions);
  const addToast = useStore((s) => s.addToast);
  const [selectedId, setSelectedId] = useState<string>(editions[0]?.id ?? '');
  const [draft, setDraft] = useState<BoardEdition | null>(null);
  const [busy, setBusy] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  function toggleGroup(key: string) {
    setOpenGroup((cur) => (cur === key ? null : key));
  }

  useEffect(() => {
    const source = editions.find((e) => e.id === selectedId) ?? editions[0];
    if (source) setDraft(structuredClone(source));
  }, [selectedId, editions]);

  if (!draft) {
    return (
      <Modal title="⚙️ Admin – Editionen" onClose={closeDialog}>
        <p className="hint">Editionen werden geladen …</p>
      </Modal>
    );
  }

  const isBuiltIn = draft.builtIn;

  function patch(p: Partial<BoardEdition>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function patchTile(id: number, p: { name?: string; image?: string | undefined }) {
    setDraft((d) => {
      if (!d) return d;
      const tiles = d.tiles.map((t) => (t.id === id ? { ...t, ...p } : t));
      return { ...d, tiles };
    });
  }

  async function save(asCopy: boolean) {
    if (!draft) return;
    setBusy(true);
    const payload = {
      ...draft,
      id: asCopy || isBuiltIn ? '' : draft.id,
      name: asCopy && draft.name === editions.find((e) => e.id === selectedId)?.name && !isBuiltIn
        ? `${draft.name} (Kopie)`
        : draft.name,
    };
    const r = await api.saveEdition(payload);
    setBusy(false);
    if (r.ok) {
      addToast('success', 'Edition gespeichert.');
      const saved = r.edition as BoardEdition | undefined;
      if (saved) setSelectedId(saved.id);
    }
  }

  async function remove() {
    if (isBuiltIn || !draft) return;
    if (!window.confirm(`Edition „${draft.name}“ wirklich löschen?`)) return;
    const r = await api.deleteEdition(draft.id);
    if (r.ok) {
      addToast('success', 'Edition gelöscht.');
      setSelectedId('classic-de');
    }
  }

  const streets = GROUP_ORDER.map((g) => ({
    group: g,
    tiles: draft.tiles.filter((t) => t.type === 'street' && t.group === g),
  }));
  const railroads = draft.tiles.filter((t) => t.type === 'railroad');
  const utilities = draft.tiles.filter((t) => t.type === 'utility');
  const specials = draft.tiles.filter(
    (t) => !['street', 'railroad', 'utility'].includes(t.type)
  );

  return (
    <Modal title="⚙️ Admin – Editionen verwalten" onClose={closeDialog} wide>
      <div className="admin-toolbar">
        <label className="field grow">
          <span>Edition</span>
          <select className="input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {editions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.builtIn ? ' (eingebaut)' : ' (eigene)'}
              </option>
            ))}
          </select>
        </label>
        <div className="btn-row">
          {!isBuiltIn && (
            <button className="btn primary" disabled={busy} onClick={() => save(false)}>
              💾 Speichern
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => save(true)}>
            {isBuiltIn ? '💾 Als eigene Edition speichern' : '⧉ Als Kopie speichern'}
          </button>
          {!isBuiltIn && (
            <button className="btn danger" disabled={busy} onClick={remove}>
              🗑 Löschen
            </button>
          )}
        </div>
      </div>
      {isBuiltIn && (
        <p className="hint">
          Eingebaute Editionen sind schreibgeschützt – deine Änderungen werden als neue, eigene
          Edition gespeichert.
        </p>
      )}

      <div className="admin-grid">
        <section>
          <h3>Allgemein</h3>
          <label className="field">
            <span>Name</span>
            <input className="input" maxLength={40} value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>Beschreibung</span>
            <input
              className="input"
              maxLength={200}
              value={draft.description ?? ''}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Währung</span>
              <input
                className="input small"
                maxLength={3}
                value={draft.currency}
                onChange={(e) => patch({ currency: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Brettfarbe</span>
              <input
                type="color"
                value={draft.boardColor}
                onChange={(e) => patch({ boardColor: e.target.value })}
              />
            </label>
          </div>
          <h3>Bild in der Brettmitte</h3>
          <ImageUpload
            label="Bild hochladen"
            value={draft.centerImage}
            onChange={(v) => patch({ centerImage: v })}
          />
          <h3>Gruppenfarben</h3>
          <div className="color-grid">
            {GROUP_ORDER.map((g) => (
              <label key={g} className="color-row">
                <input
                  type="color"
                  value={draft.groupColors[g]}
                  onChange={(e) =>
                    patch({ groupColors: { ...draft.groupColors, [g]: e.target.value } as Record<GroupId, string> })
                  }
                />
                <span>{GROUP_LABELS[g]}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3>Straßennamen &amp; Bilder</h3>
          <div className="tile-editor">
            {streets.map(({ group, tiles }) => (
              <TileGroupSection
                key={group}
                label={`${GROUP_LABELS[group]} (${tiles.length})`}
                color={draft.groupColors[group]}
                isOpen={openGroup === group}
                onToggle={() => toggleGroup(group)}
              >
                {tiles.map((t) => (
                  <div key={t.id} className="tile-row">
                    <input
                      className="input"
                      maxLength={40}
                      value={t.name}
                      onChange={(e) => patchTile(t.id, { name: e.target.value })}
                    />
                    <ImageUpload label="Bild" value={t.image} onChange={(v) => patchTile(t.id, { image: v })} />
                  </div>
                ))}
              </TileGroupSection>
            ))}
            <TileGroupSection
              label={`🚂 Bahnhöfe (${railroads.length})`}
              neutral
              isOpen={openGroup === 'railroads'}
              onToggle={() => toggleGroup('railroads')}
            >
              {railroads.map((t) => (
                <div key={t.id} className="tile-row">
                  <input
                    className="input"
                    maxLength={40}
                    value={t.name}
                    onChange={(e) => patchTile(t.id, { name: e.target.value })}
                  />
                  <ImageUpload label="Bild" value={t.image} onChange={(v) => patchTile(t.id, { image: v })} />
                </div>
              ))}
            </TileGroupSection>
            <TileGroupSection
              label={`⚡ Werke (${utilities.length})`}
              neutral
              isOpen={openGroup === 'utilities'}
              onToggle={() => toggleGroup('utilities')}
            >
              {utilities.map((t) => (
                <div key={t.id} className="tile-row">
                  <input
                    className="input"
                    maxLength={40}
                    value={t.name}
                    onChange={(e) => patchTile(t.id, { name: e.target.value })}
                  />
                  <ImageUpload label="Bild" value={t.image} onChange={(v) => patchTile(t.id, { image: v })} />
                </div>
              ))}
            </TileGroupSection>
            <TileGroupSection
              label={`Sonderfelder (${specials.length})`}
              neutral
              isOpen={openGroup === 'specials'}
              onToggle={() => toggleGroup('specials')}
            >
              {specials.map((t) => (
                <div key={t.id} className="tile-row">
                  <span className="tile-row-pos">#{t.id}</span>
                  <input
                    className="input"
                    maxLength={40}
                    value={t.name}
                    onChange={(e) => patchTile(t.id, { name: e.target.value })}
                  />
                </div>
              ))}
            </TileGroupSection>
          </div>
        </section>
      </div>
    </Modal>
  );
}
