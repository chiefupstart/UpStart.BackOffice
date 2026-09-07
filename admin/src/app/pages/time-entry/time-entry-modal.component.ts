import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ApiService } from '../../core/api.service';
import { ConfirmDeleteService } from '../../core/confirm-delete.service';
import { formatDurationMin, parseDurationInput } from './timesheet.utils';
import type { Project, TimeEntry } from './time-entry.types';

export type TimeEntryModalResult = 'saved' | 'started' | 'deleted' | 'cancelled';

@Component({
  selector: 'app-time-entry-modal',
  standalone: true,
  imports: [FormsModule, DialogModule, ButtonModule, TextareaModule, SelectModule, DatePickerModule],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      [closable]="true"
      [style]="{ width: '32rem' }"
      (onHide)="onDialogHide()"
    >
      <ng-template pTemplate="header">
        <div class="entry-dialog-header">
          <span>{{ isEdit() ? 'Edit time entry for' : 'New time entry for' }}</span>
          <p-datepicker
            [ngModel]="entryDay()"
            (ngModelChange)="onEntryDayChange($event)"
            dateFormat="DD, dd M"
            [showIcon]="true"
            iconDisplay="input"
            appendTo="body"
            styleClass="entry-day-picker"
            inputStyleClass="entry-day-picker-input"
            ariaLabel="Entry date"
          />
        </div>
      </ng-template>
      <div class="entry-form">
        <div class="form-field">
          <label for="entry-project">Project</label>
          <p-select
            inputId="entry-project"
            [options]="projectOptions()"
            optionLabel="projectName"
            optionValue="id"
            [ngModel]="projectId()"
            (ngModelChange)="onProjectIdChange($event)"
            [filter]="true"
            filterBy="projectName,clientName"
            filterPlaceholder="Search by client or project…"
            placeholder="Select a project"
            styleClass="w-full entry-project-select"
            panelStyleClass="entry-project-select-panel"
            appendTo="body"
          >
            <ng-template #selectedItem let-option>
              @if (option) {
                <span class="entry-project-option">
                  <span class="entry-project-name">{{ option.projectName }}</span>
                  <span class="entry-project-client">{{ option.clientName }}</span>
                </span>
              }
            </ng-template>
            <ng-template #item let-option>
              <span class="entry-project-option">
                <span class="entry-project-name">{{ option.projectName }}</span>
                <span class="entry-project-client">{{ option.clientName }}</span>
              </span>
            </ng-template>
          </p-select>
        </div>

        @if (manualTasks().length > 0) {
          <div class="form-field">
            <label for="entry-task">Task</label>
            <select
              id="entry-task"
              class="task-select"
              [ngModel]="manualTaskId()"
              (ngModelChange)="onManualTaskChange($event)"
            >
              <option value="">Select a task</option>
              @for (t of manualTasks(); track t.id) {
                <option [value]="t.id">
                  {{ t.name }} ({{ t.isBillable ? 'Billable' : 'Non-billable' }})
                </option>
              }
            </select>
          </div>
        }

        @if (showAsanaTaskPicker()) {
          <div class="form-field">
            <label for="entry-asana-task">Asana task</label>
            @if (syncingAsanaTasks()) {
              <p class="sync-hint">Syncing from Asana…</p>
            } @else {
              <select
                id="entry-asana-task"
                class="task-select"
                [ngModel]="asanaTaskId()"
                (ngModelChange)="onAsanaTaskChange($event)"
              >
                <option value="">Select an Asana task</option>
                @for (t of asanaTasks(); track t.id) {
                  <option [value]="t.id">{{ t.name }}</option>
                }
              </select>
            }
          </div>
        }

        <div class="form-field">
          <label for="entry-notes">Notes (optional)</label>
          <textarea
            pTextarea
            id="entry-notes"
            rows="3"
            placeholder="What did you work on?"
            [ngModel]="notes()"
            (ngModelChange)="notes.set($event)"
            class="w-full"
          ></textarea>
        </div>

        <div class="form-field duration-field">
          <label for="entry-duration">Duration</label>
          <input
            id="entry-duration"
            type="text"
            class="duration-input"
            placeholder="0:00"
            [ngModel]="durationInput()"
            (ngModelChange)="durationInput.set($event)"
          />
        </div>

        @if (error()) {
          <div class="error-text" role="alert">{{ error() }}</div>
        }
      </div>

      <ng-template pTemplate="footer">
        <div class="dialog-footer">
          <div class="footer-left">
            @if (isEdit()) {
              <button
                type="button"
                pButton
                label="Delete"
                severity="danger"
                [text]="true"
                [loading]="saving()"
                (click)="deleteEntry()"
              ></button>
            }
          </div>
          <div class="footer-right">
            <button
              type="button"
              pButton
              label="Cancel"
              severity="secondary"
              [text]="true"
              (click)="cancel()"
            ></button>
            @if (isEdit()) {
              <button
                type="button"
                pButton
                label="Save"
                [loading]="saving()"
                [disabled]="!canSubmit() || saving()"
                (click)="saveEntry()"
              ></button>
            } @else {
              @if (canSave()) {
                <button
                  type="button"
                  pButton
                  label="Save entry"
                  [loading]="saving()"
                  [disabled]="!canSubmit() || saving()"
                  (click)="saveEntry()"
                ></button>
              }
              <button
                type="button"
                pButton
                label="Start timer"
                icon="pi pi-clock"
                severity="success"
                [outlined]="true"
                [loading]="saving()"
                [disabled]="!canSubmit() || saving()"
                (click)="startTimer()"
              ></button>
            }
          </div>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .entry-dialog-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.35rem 0.5rem;
      font-size: 1.125rem;
      font-weight: 600;
      color: #2d2d2d;
    }

    :host ::ng-deep .entry-day-picker.p-datepicker,
    :host ::ng-deep .entry-day-picker {
      width: auto;
    }

    :host ::ng-deep .entry-day-picker-input,
    :host ::ng-deep .entry-day-picker .p-inputtext {
      width: auto;
      min-width: 12.5rem;
      border: none;
      background: transparent;
      padding: 0.15rem 1.75rem 0.15rem 0.15rem;
      font-size: 1.125rem;
      font-weight: 600;
      color: #7c3aed;
      box-shadow: none;
      cursor: pointer;
    }

    :host ::ng-deep .entry-day-picker .p-datepicker-input-icon-container,
    :host ::ng-deep .entry-day-picker .p-datepicker-dropdown {
      color: #7c3aed;
    }

    .entry-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .form-field label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 0.35rem;
      color: #2d2d2d;
    }

    .entry-project-option {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-width: 0;
      line-height: 1.3;
    }

    .entry-project-name {
      font-weight: 600;
      font-size: 0.875rem;
      color: #2d2d2d;
    }

    .entry-project-client {
      font-weight: 400;
      font-size: 0.8125rem;
      color: #6b7785;
    }

    .duration-input {
      width: 6rem;
      border: 1px solid #e2e6ea;
      border-radius: 4px;
      padding: 0.5rem 0.625rem;
      font-size: 16px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .task-select {
      width: 100%;
      border: 1px solid #e2e6ea;
      border-radius: 4px;
      background: #fff;
      padding: 0.625rem 0.75rem;
      font-size: 14px;
      color: #2d2d2d;
    }

    .sync-hint {
      margin: 0;
      padding: 0.625rem 0.75rem;
      border: 1px solid #e2e6ea;
      border-radius: 4px;
      background: #f8f9fa;
      font-size: 14px;
      color: #6b7785;
    }

    .error-text {
      color: #a94442;
      font-size: 13px;
    }

    .dialog-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      gap: 0.5rem;
    }

    .footer-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  `,
})
export class TimeEntryModalComponent {
  private readonly api = inject(ApiService);
  private readonly deleteConfirm = inject(ConfirmDeleteService);

  visible = false;
  saving = signal(false);
  error = signal<string | null>(null);
  isEdit = signal(false);
  entryDay = signal(new Date());
  editingEntry = signal<TimeEntry | null>(null);
  projects = signal<Project[]>([]);
  asanaConnected = signal(false);

  projectId = signal('');
  manualTaskId = signal('');
  asanaTaskId = signal('');
  notes = signal('');
  durationInput = signal('');
  loadingAsanaNotes = signal(false);
  syncingAsanaTasks = signal(false);

  private asanaSyncPromise: Promise<void> | null = null;

  readonly selectedProject = computed(() => {
    const id = this.projectId();
    return this.projects().find((p) => p.id === id);
  });

  readonly manualTasks = computed(() => {
    const tasks = this.selectedProject()?.tasks ?? [];
    return tasks.filter((t) => t.source !== 'ASANA');
  });

  readonly asanaTasks = computed(() => {
    const tasks = this.selectedProject()?.tasks ?? [];
    return tasks.filter((t) => t.source === 'ASANA' && t.isActive !== false);
  });

  readonly showAsanaTaskPicker = computed(
    () => this.asanaConnected() && !!this.selectedProject()?.asanaSectionGid,
  );

  readonly requiresTask = computed(
    () => this.manualTasks().length > 0 || this.showAsanaTaskPicker(),
  );

  readonly hasSelectedTask = computed(
    () => !!(this.manualTaskId() || this.asanaTaskId()),
  );

  readonly canSubmit = computed(() => {
    if (!this.projectId()) return false;
    if (this.requiresTask() && !this.hasSelectedTask()) return false;
    return true;
  });

  readonly selectableProjects = computed(() => {
    const editingProjectId = this.editingEntry()?.project.id;
    return this.projects().filter(
      (p) => p.isActive !== false || p.id === editingProjectId,
    );
  });

  readonly projectOptions = computed(() =>
    this.selectableProjects().map((p) => ({
      id: p.id,
      projectName: p.name,
      clientName: p.client.name,
    })),
  );

  readonly canSave = computed(() => {
    const parsed = parseDurationInput(this.durationInput());
    return parsed !== null && parsed > 0;
  });

  private resolve: ((result: TimeEntryModalResult) => void) | null = null;

  open(options: {
    day: Date;
    projects: Project[];
    asanaConnected?: boolean;
    entry?: TimeEntry;
  }): Promise<TimeEntryModalResult> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.projects.set(options.projects);
      this.asanaConnected.set(options.asanaConnected ?? false);
      this.entryDay.set(new Date(options.day));
      this.editingEntry.set(options.entry ?? null);
      this.isEdit.set(!!options.entry);
      this.error.set(null);
      this.loadingAsanaNotes.set(false);

      if (options.entry) {
        this.projectId.set(options.entry.project.id);
        this.notes.set(options.entry.description ?? '');
        this.durationInput.set(
          options.entry.durationMin != null
            ? formatDurationMin(options.entry.durationMin)
            : '',
        );
        this.setTaskIdsFromEntry(options.entry);
      } else {
        this.projectId.set('');
        this.manualTaskId.set('');
        this.asanaTaskId.set('');
        this.notes.set('');
        this.durationInput.set('');
      }

      this.visible = true;

      const projectId = options.entry?.project.id;
      if (projectId) {
        const project = options.projects.find((p) => p.id === projectId);
        if (project?.asanaSectionGid && this.asanaConnected()) {
          void this.syncAsanaTasksIfNeeded(project.id);
        }
      }
    });
  }

  private setTaskIdsFromEntry(entry: TimeEntry) {
    const taskId = entry.projectTaskId ?? entry.projectTask?.id ?? '';
    if (!taskId) {
      this.manualTaskId.set('');
      this.asanaTaskId.set('');
      return;
    }

    const project = this.projects().find((p) => p.id === entry.project.id);
    const cachedTask = project?.tasks?.find((t) => t.id === taskId);
    const isAsana =
      entry.projectTask?.source === 'ASANA' ||
      cachedTask?.source === 'ASANA' ||
      (!!project?.asanaSectionGid && cachedTask?.source !== 'MANUAL' && !!entry.projectTask);

    if (isAsana) {
      this.asanaTaskId.set(taskId);
      this.manualTaskId.set('');
      this.ensureEntryTaskInProject(entry);
    } else {
      this.manualTaskId.set(taskId);
      this.asanaTaskId.set('');
    }
  }

  private ensureEntryTaskInProject(entry: TimeEntry) {
    const taskId = entry.projectTaskId ?? entry.projectTask?.id;
    const pt = entry.projectTask;
    if (!taskId || !pt) return;

    this.projects.update((list) =>
      list.map((p) => {
        if (p.id !== entry.project.id) return p;
        if (p.tasks?.some((t) => t.id === taskId)) return p;
        return {
          ...p,
          tasks: [
            ...(p.tasks ?? []),
            {
              id: pt.id,
              projectId: p.id,
              name: pt.name,
              source: 'ASANA' as const,
              isBillable: pt.isBillable,
              sortOrder: 999,
              isActive: true,
            },
          ],
        };
      }),
    );
  }

  onProjectIdChange(id: string) {
    const p = this.projects().find((x) => x.id === id);
    if (!p) return;
    this.selectProject(p);
  }

  selectProject(p: Project) {
    this.projectId.set(p.id);
    this.manualTaskId.set('');
    this.asanaTaskId.set('');
    const manual = (p.tasks ?? []).filter((t) => t.source !== 'ASANA');
    if (manual.length === 1) {
      this.manualTaskId.set(manual[0].id);
    }
    if (p.asanaSectionGid && this.asanaConnected()) {
      void this.syncAsanaTasksIfNeeded(p.id);
    }
  }

  onManualTaskChange(taskId: string) {
    this.manualTaskId.set(taskId);
    if (taskId) this.asanaTaskId.set('');
  }

  async syncAsanaTasksIfNeeded(projectId: string) {
    if (!this.asanaConnected()) return;

    if (this.asanaSyncPromise) {
      await this.asanaSyncPromise;
      return;
    }

    this.syncingAsanaTasks.set(true);
    this.asanaSyncPromise = this.syncAsanaTasksForProject(projectId).finally(() => {
      this.syncingAsanaTasks.set(false);
      this.asanaSyncPromise = null;
    });
    await this.asanaSyncPromise;
  }

  private async syncAsanaTasksForProject(projectId: string) {
    try {
      const synced = await this.api.post<Project>(`/projects/${projectId}/asana/sync`);
      this.applySyncedProject(synced);
    } catch {
      /* keep existing tasks if sync fails */
    }
  }

  private applySyncedProject(synced: Project) {
    const syncedAsana = (synced.tasks ?? []).filter(
      (t) => t.source === 'ASANA' && t.isActive !== false,
    );
    const selectedId = this.asanaTaskId();
    const entryTask = this.editingEntry()?.projectTask;

    this.projects.update((list) =>
      list.map((p) => {
        if (p.id !== synced.id) return p;
        const manual = (p.tasks ?? []).filter((t) => t.source !== 'ASANA');
        let asana = syncedAsana;

        if (
          selectedId &&
          !asana.some((t) => t.id === selectedId) &&
          entryTask?.id === selectedId
        ) {
          asana = [
            {
              id: entryTask.id,
              projectId: p.id,
              name: entryTask.name,
              source: 'ASANA' as const,
              isBillable: entryTask.isBillable,
              sortOrder: 999,
              isActive: true,
            },
            ...asana,
          ];
        }

        return {
          ...p,
          asanaSectionGid: synced.asanaSectionGid ?? p.asanaSectionGid,
          tasks: [...manual, ...asana],
        };
      }),
    );
  }

  async onAsanaTaskChange(taskId: string) {
    this.asanaTaskId.set(taskId);
    if (taskId) this.manualTaskId.set('');

    if (!taskId) return;

    const task = this.asanaTasks().find((t) => t.id === taskId);
    if (!task?.asanaTaskGid) return;

    this.loadingAsanaNotes.set(true);
    try {
      const result = await this.api.get<{ notes: string | null; permalinkUrl: string | null }>(
        `/asana/tasks/${encodeURIComponent(task.asanaTaskGid)}/notes`,
      );
      const parts: string[] = [];
      if (result.notes) parts.push(result.notes);
      if (result.permalinkUrl) parts.push(result.permalinkUrl);
      if (parts.length > 0) {
        this.notes.set(parts.join('\n\n'));
      }
    } catch {
      /* keep existing notes if Asana fetch fails */
    } finally {
      this.loadingAsanaNotes.set(false);
    }
  }

  onEntryDayChange(value: Date | Date[] | null) {
    const next = Array.isArray(value) ? value[0] : value;
    if (!(next instanceof Date) || Number.isNaN(next.getTime())) return;
    this.entryDay.set(next);
  }

  onDialogHide() {
    this.error.set(null);
  }

  cancel() {
    this.visible = false;
    this.resolve?.('cancelled');
    this.resolve = null;
  }

  private dayStartAt(hour = 9): Date {
    const d = new Date(this.entryDay());
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  private startedAtOnEntryDay(source: Date): Date {
    const day = this.entryDay();
    const next = new Date(source);
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    return next;
  }

  private selectedProjectTaskId(): string {
    return this.asanaTaskId() || this.manualTaskId();
  }

  private entryPayload(projectId: string) {
    const payload: Record<string, unknown> = {
      projectId,
      description: this.notes().trim() || undefined,
    };
    const taskId = this.selectedProjectTaskId();
    if (taskId) payload['projectTaskId'] = taskId;
    return payload;
  }

  async saveEntry() {
    const projectId = this.projectId();
    if (!projectId) {
      this.error.set('Choose a project.');
      return;
    }
    if (this.requiresTask() && !this.hasSelectedTask()) {
      this.error.set('Choose a task or Asana task.');
      return;
    }

    const existing = this.editingEntry();
    let durationMin: number;
    const trimmed = this.durationInput().trim();
    if (existing && !trimmed) {
      durationMin = existing.durationMin ?? 0;
    } else {
      const parsed = parseDurationInput(this.durationInput());
      if (parsed === null) {
        this.error.set('Invalid duration. Use H:MM (2:30) or decimal hours (2.5).');
        return;
      }
      durationMin = parsed;
    }

    if (!existing && durationMin <= 0) {
      this.error.set('Enter a duration or use Start timer.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    try {
      const startedAt = existing
        ? this.startedAtOnEntryDay(new Date(existing.startedAt))
        : this.dayStartAt();
      const stoppedAt = new Date(startedAt.getTime() + durationMin * 60_000);

      if (existing) {
        await this.api.put(`/time-entries/${existing.id}`, {
          ...this.entryPayload(projectId),
          startedAt: startedAt.toISOString(),
          stoppedAt: stoppedAt.toISOString(),
        });
      } else {
        await this.api.post('/time-entries', {
          ...this.entryPayload(projectId),
          startedAt: startedAt.toISOString(),
          stoppedAt: stoppedAt.toISOString(),
        });
      }

      this.visible = false;
      this.resolve?.('saved');
      this.resolve = null;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      this.saving.set(false);
    }
  }

  async startTimer() {
    const projectId = this.projectId();
    if (!projectId) {
      this.error.set('Choose a project.');
      return;
    }
    if (this.requiresTask() && !this.hasSelectedTask()) {
      this.error.set('Choose a task or Asana task.');
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    try {
      await this.api.post('/time-entries', {
        ...this.entryPayload(projectId),
        startedAt: new Date().toISOString(),
      });

      this.visible = false;
      this.resolve?.('started');
      this.resolve = null;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to start timer');
    } finally {
      this.saving.set(false);
    }
  }

  deleteEntry() {
    const existing = this.editingEntry();
    if (!existing) return;

    const label = `${existing.project.name} (${existing.project.client.name})`;
    this.deleteConfirm.confirm({
      message: `Delete this time entry for "${label}"? This cannot be undone.`,
      accept: () => this.performDelete(existing.id),
    });
  }

  private async performDelete(entryId: string) {
    this.saving.set(true);
    this.error.set(null);

    try {
      await this.api.delete(`/time-entries/${entryId}`);
      this.visible = false;
      this.resolve?.('deleted');
      this.resolve = null;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      this.saving.set(false);
    }
  }
}
