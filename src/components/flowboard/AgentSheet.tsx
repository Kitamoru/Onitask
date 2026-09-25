'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button, Segments, TextInput } from '@/components/ui/desk-ui';
import { listAgents, revokeAgent, updateAgent, type AgentConnector } from '@/lib/api/agents';
import type { AgentCardData, TaskEntity } from '@/types/flowboard';

export type AgentSheetTab = 'status' | 'connection';
export interface AgentSheetProps { open: boolean; onClose: () => void; agent: AgentCardData | null; tasks: TaskEntity[]; workspaceId: string | null; canManage: boolean; onSaved?: () => void; onOpenTask?: (taskId: string) => void; }
const TABS: Array<{ value: AgentSheetTab; label: string }> = [{ value: 'status', label: 'Статус' }, { value: 'connection', label: 'Подключение' }];
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="flex flex-col gap-2"><span className="text-xs uppercase tracking-wide text-text-muted">{label}</span>{children}</label>; }

export function AgentSheet({ open, onClose, agent, tasks, workspaceId, canManage, onSaved, onOpenTask }: AgentSheetProps) {
  const [tab, setTab] = useState<AgentSheetTab>('status');
  const [connector, setConnector] = useState<AgentConnector | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(''); const [baseUrl, setBaseUrl] = useState(''); const [apiKey, setApiKey] = useState(''); const [model, setModel] = useState('');
  useEffect(() => {
    if (!open) return;
    setTab('status'); setEditing(false); setConfirmDelete(false); setError(null); setApiKey(''); setConnector(null);
    if (!agent) return;
    setLoading(true);
    void listAgents(workspaceId ?? undefined).then((result) => { if (result.error) setError(result.message ?? 'Не удалось загрузить подключение агента.'); else setConnector(result.data?.find((item) => item.worker_id === agent.id) ?? null); setLoading(false); });
  }, [agent, open, workspaceId]);
  useEffect(() => { if (connector) { setName(connector.agent_name); setBaseUrl(connector.base_url); setModel(connector.model ?? ''); } }, [connector]);
  const activeTasks = agent ? tasks.filter((task) => task.assigned_to === agent.id && task.column !== 'done') : [];
  const handoffTasks = agent ? tasks.filter((task) => task.handoff_to === agent.id && task.column !== 'done') : [];

  const save = async () => { if (!connector) return; setSaving(true); setError(null); const result = await updateAgent(connector.id, { agent_name: name.trim(), base_url: baseUrl.trim(), model: model.trim() || null, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) }); setSaving(false); if (result.error || !result.data) { setError(result.message ?? 'Не удалось сохранить подключение.'); return; } setConnector(result.data); setEditing(false); setApiKey(''); onSaved?.(); };
  const remove = async () => { if (!connector) return; setDeleting(true); setError(null); const result = await revokeAgent(connector.id); setDeleting(false); if (result.error) { setError(result.message ?? 'Не удалось удалить подключение.'); return; } onSaved?.(); onClose(); };


  return (
    <BottomSheet open={open} onClose={onClose}>
      {agent && <div className="flex flex-col gap-5 px-4 pb-6">
        <div className="flex items-center gap-2"><span className="text-xl text-text-muted">◆</span><div className="min-w-0 flex-1"><h2 className="truncate text-[18px] font-semibold text-text">{agent.name}</h2><p className="text-body-sm text-text-muted">AI-агент</p></div></div>
        <Segments options={TABS} value={tab} onChange={setTab} aria-label="Вкладки агента" />
        {tab === 'status' ? <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-surface p-3 text-body-sm text-text">{agent.interpretationHint ?? 'Нет данных для интерпретации.'}</div>
          <section className="rounded-lg border border-line bg-surface p-3"><h3 className="mb-2 text-sm font-medium text-text">Метрики · 7 дней</h3><div className="grid grid-cols-2 gap-3 text-body-sm text-text-muted"><span>Задач/день: <b className="text-text">{agent.throughput ?? 0}</b></span><span>Возвраты: <b className="text-text">{agent.reworkCount ?? 0}</b></span><span>В очереди: <b className="text-text">{activeTasks.length}</b></span><span>Эскалации: <b className="text-text">{agent.pendingEscalations ?? 0}</b></span></div></section>
          {handoffTasks.length > 0 && <section className="rounded-lg border border-line bg-surface p-3"><h3 className="mb-2 text-sm font-medium text-text">Входящие передачи · {handoffTasks.length}</h3>{handoffTasks.map((task) => <button key={task.id} type="button" className="block text-left text-body-sm text-text-muted hover:text-text" onClick={() => onOpenTask?.(task.id)}>{task.full_id} · {task.title}</button>)}</section>}
          <section className="rounded-lg border border-line bg-surface p-3"><h3 className="mb-2 text-sm font-medium text-text">Активные задачи · {activeTasks.length}</h3>{activeTasks.length === 0 ? <p className="text-body-sm text-text-muted">Нет активных задач.</p> : activeTasks.map((task) => <button key={task.id} type="button" className="block text-left text-body-sm text-text-muted hover:text-text" onClick={() => onOpenTask?.(task.id)}>{task.full_id} · {task.title}</button>)}</section>
        </div> : <div className="flex flex-col gap-4">
          {!canManage ? <p className="text-sm text-text-muted">Настройки подключения доступны владельцу или администратору доски.</p> : loading ? <p className="text-sm text-text-muted">Загружаем подключение…</p> : !connector ? <p className="text-sm text-text-muted">Подключение агента не найдено.</p> : <>{error && <p className="text-sm text-[var(--color-error)]" role="alert">{error}</p>}<Field label="Название"><TextInput value={name} onChange={(event) => setName(event.target.value)} disabled={!editing || saving} /></Field><Field label="Endpoint"><TextInput value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} disabled={!editing || saving} inputMode="url" /></Field><Field label="Ключ"><TextInput value={apiKey || connector.secret_hint || ''} onChange={(event) => setApiKey(event.target.value)} disabled={!editing || saving} type="password" /></Field><Field label="Модель"><TextInput value={model} onChange={(event) => setModel(event.target.value)} disabled={!editing || saving} /></Field>{editing ? <Button variant="solid" type="button" disabled={saving || !name.trim() || !baseUrl.trim()} onClick={() => void save()}>{saving ? 'Сохраняем…' : 'Сохранить'}</Button> : <Button variant="outline" type="button" onClick={() => setEditing(true)}>Редактировать</Button>}<div className="border-t border-line pt-4">{confirmDelete ? <div className="flex flex-col gap-2"><p className="text-sm text-text-muted">Удалить подключение? Секрет будет удалён, история задач сохранится.</p><Button variant="solid" fill="var(--color-error)" textColor="var(--color-text-primary)" type="button" disabled={deleting} onClick={() => void remove()}>{deleting ? 'Удаляем…' : 'Да, удалить подключение'}</Button></div> : <Button variant="outline" type="button" disabled={saving} onClick={() => setConfirmDelete(true)}>Удалить подключение</Button>}</div></>}
        </div>}
      </div>}
    </BottomSheet>
  );
}

