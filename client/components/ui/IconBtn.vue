<template>
  <button class="icon-btn rounded-md border border-gray-600 flex items-center justify-center h-9 w-9 relative" :disabled="disabled" :class="className" @click="clickBtn">
    <span class="material-icons icon-text">{{ icon }}</span>
  </button>
</template>

<script>
export default {
  props: {
    icon: String,
    disabled: Boolean,
    bgColor: {
      type: String,
      default: 'primary'
    }
  },
  data() {
    return {}
  },
  computed: {
    className() {
      var classes = []
      classes.push(`bg-${this.bgColor}`)
      return classes.join(' ')
    }
  },
  methods: {
    clickBtn(e) {
      if (this.disabled) {
        e.preventDefault()
        return
      }
      this.$emit('click')
      e.stopPropagation()
    }
  },
  mounted() {}
}
</script>

<style>
button.icon-btn:disabled {
  cursor: not-allowed;
}
button.icon-btn::before {
  content: '';
  position: absolute;
  border-radius: 6px;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(255, 255, 255, 0);
  transition: all 0.1s ease-in-out;
}
button.icon-btn:hover:not(:disabled)::before {
  background-color: rgba(255, 255, 255, 0.1);
}
button.icon-btn:disabled::before {
  background-color: rgba(0, 0, 0, 0.2);
}
</style>