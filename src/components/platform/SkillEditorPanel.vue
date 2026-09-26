<template>
  <view class="section-heading">
    <view>
      <text class="eyebrow">SKILL STUDIO</text>
      <h1>{{ editingId ? '编辑你的 Skill' : '创建意识 Skill' }}</h1>
    </view>
    <n-button
      class="primary"
      :disabled="busy || submissionIssues.length > 0"
      @click="run(saveSkill)"
    >
      保存草稿
    </n-button>
  </view>
  <view class="editor-grid">
    <view>
      <view class="panel">
        <h2>基本信息</h2>
        <view v-if="editingId" class="row">
          <n-button class="small" @click="run(() => copySkill(editingId))">
            {{ tr('复制 ID', 'Copy ID') }}
          </n-button>
        </view>
        <n-label>
          名称
          <n-input v-model="draft.name" maxlength="100" />
        </n-label>
        <n-label>
          {{ tr('内容语言', 'Content language') }}
          <select v-model="draft.language">
            <option value="zh-CN">中文</option>
            <option value="en">English</option>
            <option
              v-if="draft.language && !['zh-CN', 'en'].includes(draft.language)"
              :value="draft.language"
            >
              {{ draft.language }}
            </option>
          </select>
        </n-label>
        <n-label>
          包名
          <n-input class="readonly-package" :model-value="draft.slug" readonly />
        </n-label>
        <p class="readonly-package-note">包名由系统自动分配，创建后不可更改。</p>
        <n-label>
          人格与表达方式（必填）
          <n-textarea
            v-model="draft.persona.instructions"
            rows="7"
            maxlength="30000"
            required
            placeholder="描述你的性格、说话方式和表达习惯"
          />
        </n-label>
        <n-label>
          自我认知（必填）
          <n-textarea
            v-model="draft.persona.self_description"
            rows="3"
            maxlength="10000"
            required
            placeholder="你如何理解自己，以及你看重什么"
          />
        </n-label>
      </view>
      <view class="panel">
        <h2>{{ tr('选择形象', 'Choose an avatar') }}</h2>
        <p class="muted">
          {{
            tr(
              '形象将显示在 Skill 广场和聊天中。保存草稿后，提交发布即可更新公开形象。',
              'Your avatar appears in the Skill commons and chats. Publish your saved changes to update the public avatar.',
            )
          }}
        </p>
        <avatar-picker v-model="draft.avatar_id" />
      </view>
      <view class="panel">
        <view class="section-heading">
          <h2>记忆片段（必填）</h2>
          <n-button class="small" @click="addMemory">添加记忆</n-button>
        </view>
        <p class="muted">草稿仅自己可见。新增记忆默认勾选公开，可在发布前取消。</p>
        <view v-for="(memory, index) in draft.memory.fragments" :key="memory.id" class="memory">
          <view class="row">
            <n-input v-model="memory.time" placeholder="时间（可选）" />
            <n-button class="small danger" @click="removeMemory(index)"> 移除 </n-button>
          </view>
          <n-textarea
            v-model="memory.content"
            rows="3"
            maxlength="10000"
            required
            placeholder="记录一段真实经历…"
          />
        </view>
        <p v-if="!draft.memory.fragments.length" class="muted">还没有记忆片段。</p>
      </view>
      <view class="panel">
        <h2>图片素材</h2>
        <p class="muted">支持 PNG / JPEG / WebP，每个文件不超过 10 MB。</p>
        <n-button class="small" @click="run(() => uploadAsset('image'))"> 上传图片 </n-button>
        <view v-for="(reference, key) in imageAssets" :key="key" class="row spaced">
          <text>{{ reference.split('/')[1] }}</text>
          <n-button class="small" @click="removeAsset(key)"> 移除图片 </n-button>
        </view>
      </view>
      <view class="panel">
        <h2>声音素材</h2>
        <p class="muted">支持 WAV / OGG / MP3，每个文件不超过 10 MB。声音文件仅作为素材保存。</p>
        <n-button class="small" @click="run(() => uploadAsset('audio'))"> 上传声音 </n-button>
        <view v-for="(reference, key) in audioAssets" :key="key" class="row spaced">
          <text>{{ reference.split('/')[1] }}</text>
          <n-button class="small" @click="removeAsset(key)"> 移除声音 </n-button>
        </view>
      </view>
    </view>
    <view>
      <view class="panel sticky">
        <h2>发布预览</h2>
        <skill-avatar :avatar-id="draft.avatar_id" :name="draft.name" :size="88" />
        <p>名称和人格会随 Skill 发布。请确认下方公开范围。</p>
        <n-label class="check">
          <n-input type="checkbox" v-model="publication.listed" @change="listingChanged" />
          允许出现在公共目录
        </n-label>
        <n-label class="check">
          <n-input type="checkbox" v-model="publication.chat" :disabled="!publication.listed" />
          允许其他用户交互
        </n-label>
        <n-label class="check">
          <n-input type="checkbox" v-model="publication.download" :disabled="!publication.listed" />
          允许下载
        </n-label>
        <h3>可公开使用的记忆</h3>
        <n-label v-for="m in draft.memory.fragments" :key="m.id" class="check">
          <n-input type="checkbox" :value="m.id" v-model="publication.memory_ids" />
          <text>{{ m.time }} {{ m.content.slice(0, 90) }}</text>
        </n-label>
        <p v-if="publication.download" class="muted">
          允许下载的最新版本每周同步至 GitHub，全部图片和声音素材随包分发。
        </p>
        <view class="publication-validation">
          <h3>发布合规确认</h3>
          <p v-for="issue in submissionIssues" :key="issue" class="validation-error">
            {{ issue }}
          </p>
          <p v-if="!submissionIssues.length" class="validation-success">必填内容已填写完整。</p>
          <n-label class="check">
            <n-input type="checkbox" v-model="complianceConfirmed" />
            我确认拥有这些内容的使用与发布授权，并同意当前选择的公开范围。
          </n-label>
        </view>
        <p v-if="detail?.published_version_id" class="muted">
          当前版本
          {{
            detail.versions?.find((v) => v.id === detail.published_version_id)?.version
          }}；提交修改后自动生成新版本。
        </p>
        <github-skill-link :url="githubUrl" />
        <n-button
          class="primary full"
          :disabled="busy || submissionIssues.length > 0 || !complianceConfirmed"
          @click="run(publishSkill)"
        >
          {{ detail?.published_version_id ? '上传更新' : '上传记忆' }}
        </n-button>
        <n-button v-if="editingId" class="full" @click="run(unpublishSkill)"> 从平台下架 </n-button>
        <p v-if="waitingWeekly" class="muted">GitHub · 等待每周同步。{{ scheduleText }}</p>
        <view v-if="currentJob" class="panel">
          <p>
            GitHub · {{ statusName(currentJob.status) }} ·
            {{ currentJob.version }}
          </p>
          <p v-if="currentJob.last_error">{{ currentJob.last_error }}</p>
          <p v-if="currentJob.result?.reason">{{ currentJob.result.reason }}</p>
          <n-button
            v-if="currentJob.status === 'failed'"
            class="small"
            @click="run(() => retryJob(currentJob))"
          >
            重试同步
          </n-button>
        </view>
        <p v-if="jobStatusError" class="validation-error">
          {{ jobStatusError }}
        </p>
        <p v-if="startError" class="validation-error" role="alert">
          {{ tr('无法开始对话：', 'Unable to start chat: ') }}{{ startError }}
        </p>
        <n-button
          v-if="detail?.published_version_id"
          class="full"
          :disabled="busy || starting"
          @click="beginChat(detail)"
        >
          {{ starting ? tr('正在启动…', 'Starting…') : '与已发布版本对话' }}
        </n-button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { onMounted } from 'vue';
import { usePageUi } from '../../composables/usePageUi.js';
import { useSkillEditor } from '../../composables/useSkillEditor.js';
import { useStartChat } from '../../composables/useStartChat.js';
import { tr } from '../../services/locale.js';
import { copySkill as copy } from '../../services/skillActions.js';
import { statusName } from '../../services/presentation.js';
const props = defineProps({ pageName: String, query: Object, active: Boolean });
const { busy, run, notify } = usePageUi();
const { starting, startError, beginChat } = useStartChat();
const copySkill = (value) => copy(value, notify);
import { NInput, NTextarea, NButton, NLabel } from '../native.js';
import GithubSkillLink from '../GithubSkillLink.vue';
import AvatarPicker from '../AvatarPicker.vue';
import SkillAvatar from '../SkillAvatar.vue';
const {
  detail,
  editingId,
  draft,
  publication,
  complianceConfirmed,
  submissionIssues,
  imageAssets,
  audioAssets,
  jobStatusError,
  currentJob,
  githubUrl,
  waitingWeekly,
  scheduleText,
  saveSkill,
  publishSkill,
  listingChanged,
  addMemory,
  removeMemory,
  unpublishSkill,
  uploadAsset,
  retryJob,
  loadEditor,
  initializeDraft,
} = useSkillEditor({ props, notify });
function removeAsset(key) {
  delete draft.value.assets[key];
  notify('已移除素材，请保存草稿');
}
onMounted(() => run(props.pageName === 'new' ? initializeDraft : loadEditor));
</script>
