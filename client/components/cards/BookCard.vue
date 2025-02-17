<template>
  <div class="relative">
    <!-- New Book Flag -->
    <div v-show="isNew" class="absolute top-4 left-0 w-4 h-10 pr-2 bg-darkgreen box-shadow-xl z-20">
      <div class="absolute top-0 left-0 w-full h-full transform -rotate-90 flex items-center justify-center">
        <p class="text-center text-sm">New</p>
      </div>
      <div class="absolute -bottom-4 left-0 triangle-right" />
    </div>

    <div class="rounded-sm h-full overflow-hidden relative" :style="{ padding: `16px ${paddingX}px` }" @mouseover="isHovering = true" @mouseleave="isHovering = false" @click="clickCard">
      <nuxt-link :to="isSelectionMode ? '' : `/audiobook/${audiobookId}`" class="cursor-pointer">
        <div class="w-full relative box-shadow-book" :style="{ height: height + 'px' }">
          <cards-book-cover :audiobook="audiobook" :author-override="authorFormat" :width="width" />

          <div v-show="isHovering || isSelectionMode" class="absolute top-0 left-0 w-full h-full bg-black rounded" :class="overlayWrapperClasslist">
            <div v-show="!isSelectionMode && !isMissing" class="h-full flex items-center justify-center">
              <div class="hover:text-gray-200 hover:scale-110 transform duration-200" @click.stop.prevent="play">
                <span class="material-icons" :style="{ fontSize: playIconFontSize + 'rem' }">play_circle_filled</span>
              </div>
            </div>

            <div v-if="userCanUpdate" v-show="!isSelectionMode" class="absolute cursor-pointer hover:text-yellow-300 hover:scale-125 transform duration-50" :style="{ top: 0.375 * sizeMultiplier + 'rem', right: 0.375 * sizeMultiplier + 'rem' }" @click.stop.prevent="editClick">
              <span class="material-icons" :style="{ fontSize: sizeMultiplier + 'rem' }">edit</span>
            </div>

            <div class="absolute cursor-pointer hover:text-yellow-300 hover:scale-125 transform duration-100" :style="{ top: 0.375 * sizeMultiplier + 'rem', left: 0.375 * sizeMultiplier + 'rem' }" @click.stop.prevent="selectBtnClick">
              <span class="material-icons" :class="selected ? 'text-yellow-400' : ''" :style="{ fontSize: 1.25 * sizeMultiplier + 'rem' }">{{ selected ? 'radio_button_checked' : 'radio_button_unchecked' }}</span>
            </div>
          </div>

          <div v-show="!isSelectionMode" class="absolute bottom-0 left-0 h-1 shadow-sm" :class="userIsRead ? 'bg-success' : 'bg-yellow-400'" :style="{ width: width * userProgressPercent + 'px' }"></div>

          <ui-tooltip v-if="showError" :text="errorText" class="absolute bottom-4 left-0">
            <div :style="{ height: 1.5 * sizeMultiplier + 'rem', width: 2.5 * sizeMultiplier + 'rem' }" class="bg-error rounded-r-full shadow-md flex items-center justify-end border-r border-b border-red-300">
              <span class="material-icons text-red-100 pr-1" :style="{ fontSize: 0.875 * sizeMultiplier + 'rem' }">priority_high</span>
            </div>
          </ui-tooltip>
        </div>
      </nuxt-link>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    audiobook: {
      type: Object,
      default: () => null
    },
    userProgress: {
      type: Object,
      default: () => null
    },
    width: {
      type: Number,
      default: 120
    }
  },
  data() {
    return {
      isHovering: false
    }
  },
  computed: {
    isNew() {
      return this.tags.includes('New')
    },
    tags() {
      return this.audiobook.tags || []
    },
    audiobookId() {
      return this.audiobook.id
    },
    isSelectionMode() {
      return this.$store.getters['getNumAudiobooksSelected']
    },
    selectedAudiobooks() {
      return this.$store.state.selectedAudiobooks
    },
    selected() {
      return this.$store.getters['getIsAudiobookSelected'](this.audiobookId)
    },
    processingBatch() {
      return this.$store.state.processingBatch
    },
    book() {
      return this.audiobook.book || {}
    },
    height() {
      return this.width * 1.6
    },
    sizeMultiplier() {
      return this.width / 120
    },
    paddingX() {
      return 16 * this.sizeMultiplier
    },
    title() {
      return this.book.title
    },
    playIconFontSize() {
      return Math.max(2, 3 * this.sizeMultiplier)
    },
    author() {
      return this.book.author
    },
    authorFL() {
      return this.book.authorFL || this.author
    },
    authorLF() {
      return this.book.authorLF || this.author
    },
    authorFormat() {
      if (!this.orderBy || !this.orderBy.startsWith('book.author')) return null
      return this.orderBy === 'book.authorLF' ? this.authorLF : this.authorFL
    },
    volumeNumber() {
      return this.book.volumeNumber || null
    },
    orderBy() {
      return this.$store.getters['user/getUserSetting']('orderBy')
    },
    filterBy() {
      return this.$store.getters['user/getUserSetting']('filterBy')
    },
    userProgressPercent() {
      return this.userProgress ? this.userProgress.progress || 0 : 0
    },
    userIsRead() {
      return this.userProgress ? !!this.userProgress.isRead : false
    },
    showError() {
      return this.hasMissingParts || this.hasInvalidParts || this.isMissing
    },
    isMissing() {
      return this.audiobook.isMissing
    },
    hasMissingParts() {
      return this.audiobook.hasMissingParts
    },
    hasInvalidParts() {
      return this.audiobook.hasInvalidParts
    },
    errorText() {
      if (this.isMissing) return 'Audiobook directory is missing!'
      var txt = ''
      if (this.hasMissingParts) {
        txt = `${this.hasMissingParts} missing parts.`
      }
      if (this.hasInvalidParts) {
        if (this.hasMissingParts) txt += ' '
        txt += `${this.hasInvalidParts} invalid parts.`
      }
      return txt || 'Unknown Error'
    },
    overlayWrapperClasslist() {
      var classes = []
      if (this.isSelectionMode) classes.push('bg-opacity-60')
      else classes.push('bg-opacity-40')
      if (this.selected) {
        classes.push('border-2 border-yellow-400')
      }
      return classes
    },
    userCanUpdate() {
      return this.$store.getters['user/getUserCanUpdate']
    },
    userCanDelete() {
      return this.$store.getters['user/getUserCanDelete']
    }
  },
  methods: {
    selectBtnClick() {
      if (this.processingBatch) return
      this.$store.commit('toggleAudiobookSelected', this.audiobookId)
    },
    clickError(e) {
      e.stopPropagation()
      this.$router.push(`/audiobook/${this.audiobookId}`)
    },
    play() {
      this.$store.commit('setStreamAudiobook', this.audiobook)
      this.$root.socket.emit('open_stream', this.audiobookId)
    },
    editClick() {
      this.$store.commit('showEditModal', this.audiobook)
    },
    clickCard(e) {
      if (this.isSelectionMode) {
        e.stopPropagation()
        e.preventDefault()
        this.selectBtnClick()
      }
    }
  },
  mounted() {}
}
</script>
