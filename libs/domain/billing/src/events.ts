import type { EventDef, PinSpec } from '@ugula/graph';
import { BLOB } from './model-kit.ts';

export const EVENT_TYPES = {
  importReceived: 'import.received',
  taskCompleted: 'task.completed'
} as const;

const p = (name: string, type: PinSpec['type'], label: string, description: string): PinSpec => ({
  name,
  type,
  label,
  description,
  optional: true
});

export const billingEvents: EventDef[] = [
  {
    type: EVENT_TYPES.importReceived,
    label: 'NEMSIS File Received',
    description: 'A NEMSIS file was uploaded or arrived by SFTP, and its import started.',
    payload: [
      p('importId', 'string', 'Import', 'The import the file started.'),
      p('file', BLOB, 'File', 'Where the file is stored.'),
      p('fileName', 'string', 'File Name', 'The name the file arrived with.')
    ]
  },
  {
    type: EVENT_TYPES.taskCompleted,
    label: 'Task Completed',
    description: 'A biller completed a task.',
    payload: [
      p('taskId', { id: 'task' }, 'Task', 'The task completed.'),
      p('queue', 'string', 'Queue', 'The work queue the task was in.'),
      p('outcome', 'string', 'Outcome', 'The option the biller chose.')
    ]
  }
];
