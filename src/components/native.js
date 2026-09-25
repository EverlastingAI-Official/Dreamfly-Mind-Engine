// Native H5 form controls preserve browser form/checkbox semantics inside UniApp.
import { defineComponent, h } from 'vue'
function control(tag) {
  return defineComponent({
    inheritAttrs: false,
    props: { modelValue: { default: undefined }, modelModifiers: { default: () => ({}) } },
    emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => {
        const checkbox = attrs.type === 'checkbox'
        const checked = checkbox && (Array.isArray(props.modelValue) ? props.modelValue.includes(attrs.value) : !!props.modelValue)
        return h(tag, {
          ...attrs, class: [`native-${tag}`, attrs.class], ...(checkbox ? { checked } : { value: props.modelValue }),
          onInput(event) {
            if (!checkbox) emit('update:modelValue', props.modelModifiers.number ? Number(event.target.value) : event.target.value)
            attrs.onInput?.(event)
          },
          onChange(event) {
            if (checkbox) {
              const current = props.modelValue
              emit('update:modelValue', Array.isArray(current) ? (event.target.checked ? [...current, attrs.value] : current.filter(x => x !== attrs.value)) : event.target.checked)
            }
            attrs.onChange?.(event)
          }
        })
      }
    }
  })
}
export const NInput = control('input')
export const NTextarea = control('textarea')
function container(tag) {
  return defineComponent({ inheritAttrs: false, setup: (_props, { attrs, slots }) => () => h(tag, { ...(tag === 'button' ? { type: 'button' } : {}), ...attrs, class: [`native-${tag}`, attrs.class] }, slots.default?.()) })
}
export const NButton = container('button')
export const NForm = container('form')
export const NLabel = container('label')
