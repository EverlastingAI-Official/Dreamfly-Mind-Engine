import { ref, computed, watch } from 'vue';
import { api, auth, chooseFile } from '../services/platform.js';
import { tr } from '../services/locale.js';
import { navigate, validId, takeImport } from '../services/navigation.mjs';
import {
  emptyMind,
  skillSlug,
  defaultPublication,
  publicationSettings,
  assetMaxBytes,
  skillSubmissionIssues,
} from '../../packages/mind-format/index.js';
import { useGithubSync } from './useGithubSync.js';
export function useSkillEditor({ props, notify }) {
  const cryptoId = () => crypto.randomUUID();
  const detail = ref(null),
    editingId = ref(''),
    draft = ref(emptyMind());
  const sync = useGithubSync({ detail, editingId, active: () => props.active });
  const { loadJobs } = sync;
  const publication = ref(defaultPublication(draft.value)),
    newSkillId = ref(''),
    draftRevision = ref(0),
    pendingSubmission = ref(null);
  const complianceConfirmed = ref(false),
    submissionIssues = computed(() => skillSubmissionIssues(draft.value));
  watch(
    [draft, publication],
    () => {
      complianceConfirmed.value = false;
      pendingSubmission.value = null;
    },
    {
      deep: true,
      flush: 'sync',
    },
  );
  const imageAssets = computed(() =>
    Object.fromEntries(
      Object.entries(draft.value.assets).filter(([, ref]) => /\.(png|jpe?g|webp)$/i.test(ref)),
    ),
  );
  const audioAssets = computed(() =>
    Object.fromEntries(
      Object.entries(draft.value.assets).filter(([, ref]) => /\.(wav|ogg|mp3)$/i.test(ref)),
    ),
  );

  function initializeDraft() {
    newSkillId.value = cryptoId();
    draftRevision.value = 0;
    pendingSubmission.value = null;
    draft.value = emptyMind(skillSlug(newSkillId.value));
    draft.value.name = auth.user.display_name + '的mindcopy';
    draft.value.persona.instructions = '';
    draft.value.persona.self_description = '';
    draft.value.memory.fragments = [
      {
        id: cryptoId(),
        time: '',
        content: '',
      },
    ];
    const imported = takeImport(auth.user.id);
    if (imported) {
      draft.value = {
        ...imported.mind,
        slug: draft.value.slug,
        version: '1.0.0',
      };
      notify(imported.warnings.join(' ') || '已导入，请检查后保存');
    }
    publication.value = defaultPublication(draft.value);
  }

  async function loadEditor() {
    if (!validId(props.query.id)) throw new Error(tr('Skill ID 无效', 'Invalid Skill ID'));
    const skill = await api('/skills/' + props.query.id);
    if (skill.owner_id !== auth.user.id)
      throw new Error(tr('无权编辑此 Skill', 'You cannot edit this Skill'));
    detail.value = skill;
    editingId.value = skill.id;
    draft.value = JSON.parse(JSON.stringify(skill.draft));
    publication.value = {
      ...defaultPublication(draft.value),
      ...skill.draft_publication,
    };
    draftRevision.value = skill.revision;
    listingChanged();
    await loadJobs();
  }
  async function saveSkill() {
    if (submissionIssues.value.length) throw new Error(submissionIssues.value.join('；'));
    const result = await api(editingId.value ? `/skills/${editingId.value}` : '/skills', {
      method: editingId.value ? 'PATCH' : 'POST',
      body: {
        ...(!editingId.value
          ? {
              id: newSkillId.value,
            }
          : {}),
        revision: draftRevision.value,
        content: draft.value,
        publication: publicationSettings(draft.value, publication.value),
      },
    });
    editingId.value = result.id;
    draftRevision.value = result.revision;
    pendingSubmission.value = null;
    detail.value = await api(`/skills/${result.id}`);
    notify('草稿已保存');
    if (props.pageName === 'new')
      await navigate(
        'edit',
        {
          id: result.id,
        },
        true,
      );
  }
  async function publishSkill() {
    if (!complianceConfirmed.value) throw new Error('请确认内容授权及公开范围');
    const skill = editingId.value || newSkillId.value;
    if (!pendingSubmission.value)
      pendingSubmission.value = JSON.parse(
        JSON.stringify({
          request_id: cryptoId(),
          revision: draftRevision.value,
          content: draft.value,
          publication: publicationSettings(draft.value, publication.value),
          compliance_confirmed: true,
        }),
      );
    const result = await api(`/skills/${skill}/submit`, {
      method: 'POST',
      body: pendingSubmission.value,
    });
    editingId.value = result.id;
    detail.value = await api(`/skills/${result.id}`);
    pendingSubmission.value = null;
    draft.value = JSON.parse(JSON.stringify(detail.value.draft));
    draftRevision.value = detail.value.revision;
    publication.value = {
      ...defaultPublication(draft.value),
      ...detail.value.draft_publication,
    };
    complianceConfirmed.value = false;
    notify(
      result.unchanged
        ? '内容未变化，已保留原版本'
        : result.sync_policy === 'weekly'
          ? '已上传，将在每周同步时处理'
          : '已上传',
    );
    await loadJobs();
    if (props.pageName === 'new')
      await navigate(
        'edit',
        {
          id: result.id,
        },
        true,
      );
  }
  function listingChanged() {
    if (!publication.value.listed) {
      publication.value.chat = false;
      publication.value.download = false;
    }
  }
  function addMemory() {
    const memory = {
      id: cryptoId(),
      time: '',
      content: '',
    };
    draft.value.memory.fragments.push(memory);
    publication.value.memory_ids.push(memory.id);
  }
  function removeMemory(index) {
    const [memory] = draft.value.memory.fragments.splice(index, 1);
    publication.value.memory_ids = publication.value.memory_ids.filter((id) => id !== memory.id);
  }
  async function unpublishSkill() {
    await api(`/skills/${editingId.value}/unpublish`, {
      method: 'POST',
    });
    detail.value = await api(`/skills/${editingId.value}`);
    draftRevision.value = detail.value.revision;
    pendingSubmission.value = null;
    notify('已从平台下架；已分发到 GitHub 的历史不会自动删除');
  }
  async function uploadAsset(kind) {
    const extension = kind === 'image' ? /\.(png|jpe?g|webp)$/i : /\.(wav|ogg|mp3)$/i;
    const file = await chooseFile(kind === 'image' ? '.png,.jpg,.jpeg,.webp' : '.wav,.ogg,.mp3');
    if (!file) return;
    if (file.size > assetMaxBytes) throw new Error('每个素材文件不能超过 10 MB');
    if (!extension.test(file.name))
      throw new Error(
        kind === 'image' ? '请选择 PNG、JPEG 或 WebP 图片' : '请选择 WAV、OGG 或 MP3 声音文件',
      );
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    const a = await api('/assets', {
      method: 'POST',
      body: form,
    });
    draft.value.assets[`${kind}-${a.id}`] = a.reference;
    notify('素材已上传，请保存草稿');
  }
  return {
    ...sync,
    detail,
    editingId,
    draft,
    publication,
    complianceConfirmed,
    submissionIssues,
    imageAssets,
    audioAssets,
    initializeDraft,
    loadEditor,
    saveSkill,
    publishSkill,
    listingChanged,
    addMemory,
    removeMemory,
    unpublishSkill,
    uploadAsset,
  };
}
