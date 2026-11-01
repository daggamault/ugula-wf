import * as v from 'valibot';

const text = (max: number) => v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(max));

export const notificationSchema = v.object({
  intent: v.optional(v.picklist(['primary', 'success', 'info', 'warning', 'danger']), 'success'),
  title: text(200),
  description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), null),
  link: v.optional(
    v.nullable(
      v.object({
        label: text(60),
        to: v.pipe(text(300), v.startsWith('/', 'Links stay inside the app'))
      })
    ),
    null
  )
});

export type NotificationInput = v.InferOutput<typeof notificationSchema>;
