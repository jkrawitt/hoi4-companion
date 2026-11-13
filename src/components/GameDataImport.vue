<script setup lang="ts">
/** Picks the game folder and imports the focus tree from it; shared by the header and empty states. */
import { ref } from 'vue'
import { canUseDirectoryPicker, fromFileList, pickWithDirectoryPicker } from '@/import/gameFolder'
import { useCampaign } from '@/stores/campaign'

const campaign = useCampaign()
const folderInput = ref<HTMLInputElement | null>(null)
const pickError = ref('')

const chooseFolder = async () => {
  pickError.value = ''
  if (canUseDirectoryPicker()) {
    try {
      const files = await pickWithDirectoryPicker()
      if (files) await campaign.runImport(files)
    } catch (e) {
      pickError.value = `Could not open the folder: ${String(e)}`
    }
  } else {
    folderInput.value?.click()
  }
}

const onFolderInput = async (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length > 0) await campaign.runImport(fromFileList(input.files))
  input.value = ''
}
</script>

<template>
  <div class="import">
    <p v-if="!campaign.hasData.value">
      Focus data is read from your own copy of Hearts of Iron IV, in your browser. Nothing is
      uploaded.
    </p>
    <button @click="chooseFolder" :disabled="campaign.importing.value">
      {{ campaign.hasData.value ? 'Re-import from game folder' : 'Choose game folder' }}
    </button>
    <input ref="folderInput" type="file" webkitdirectory hidden @change="onFolderInput" />
    <span v-if="!campaign.hasData.value && !canUseDirectoryPicker()" class="hint">
      Your browser will list every file in the folder you pick, which can take a moment. Chrome or
      Edge avoid this.
    </span>
    <p v-if="campaign.status.value">{{ campaign.status.value }}</p>
    <p v-if="campaign.error.value || pickError" class="issue">
      {{ campaign.error.value || pickError }}
    </p>
  </div>
</template>

<style scoped>
.hint {
  margin-left: 0.5rem;
  color: #666;
}
.issue {
  color: #b45309;
}
</style>
