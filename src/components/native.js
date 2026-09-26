// Native H5 form controls preserve browser form/checkbox semantics inside UniApp.
import { defineComponent, h, inject, ref } from 'vue';
import { pageUiKey } from '../composables/usePageUi.js';
import { publicError, tr } from '../services/locale.js';
function control(tag) {
  return defineComponent({
    inheritAttrs: false,
    props: { modelValue: { default: undefined }, modelModifiers: { default: () => ({}) } },
    emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => {
        const checkbox = attrs.type === 'checkbox';
        const checked =
          checkbox &&
          (Array.isArray(props.modelValue)
            ? props.modelValue.includes(attrs.value)
            : !!props.modelValue);
        return h(tag, {
          ...attrs,
          class: [`native-${tag}`, attrs.class],
          ...(checkbox ? { checked } : { value: props.modelValue }),
          onInput(event) {
            if (!checkbox)
              emit(
                'update:modelValue',
                props.modelModifiers.number ? Number(event.target.value) : event.target.value,
              );
            attrs.onInput?.(event);
          },
          onChange(event) {
            if (checkbox) {
              const current = props.modelValue;
              emit(
                'update:modelValue',
                Array.isArray(current)
                  ? event.target.checked
                    ? [...current, attrs.value]
                    : current.filter((x) => x !== attrs.value)
                  : event.target.checked,
              );
            }
            attrs.onChange?.(event);
          },
        });
      };
    },
  });
}
export const NInput = control('input');
export const NTextarea = control('textarea');
function container(tag) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      const pending = ref(false);
      const ui = inject(pageUiKey, null);
      const eventName = tag === 'button' ? 'onClick' : tag === 'form' ? 'onSubmit' : null;
      async function activate(event) {
        if (pending.value) {
          event.preventDefault();
          return;
        }
        try {
          const result = attrs[eventName]?.(event);
          if (result?.then) {
            pending.value = true;
            await result;
          }
        } catch (error) {
          ui?.notify(publicError(error), 'error');
        } finally {
          pending.value = false;
        }
      }
      return () =>
        h(
          tag,
          {
            ...(tag === 'button' ? { type: 'button' } : {}),
            ...attrs,
            class: [`native-${tag}`, attrs.class],
            ...(eventName ? { [eventName]: activate, 'aria-busy': pending.value } : {}),
            ...(tag === 'button' ? { disabled: attrs.disabled || pending.value } : {}),
          },
          [
            ...(slots.default?.() || []),
            ...(pending.value
              ? [
                  h('span', { class: 'action-pending', role: 'status' }, [
                    h('span', { class: 'action-spinner', 'aria-hidden': 'true' }),
                    tr('处理中…', 'Working…'),
                  ]),
                ]
              : []),
          ],
        );
    },
  });
}
export const NButton = container('button');
export const NForm = container('form');
export const NLabel = container('label');
