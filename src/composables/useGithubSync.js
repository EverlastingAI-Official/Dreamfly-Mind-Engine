import { computed, ref, watch, onUnmounted } from 'vue';
import { api } from '../services/platform.js';
import { publicError } from '../services/locale.js';
export function useGithubSync({ detail, editingId, active, notify }) {
  const settings = ref({}),
    jobs = ref([]),
    jobStatusError = ref('');
  const currentJob = computed(() => {
    const target = settings.value.target;
    return jobs.value.find(
      (job) =>
        job.skill_id === editingId.value &&
        job.version_id === detail.value?.published_version_id &&
        (!target ||
          (job.target?.owner?.toLowerCase() === target.owner &&
            job.target?.repo?.toLowerCase() === target.repo &&
            job.target?.branch === target.branch)),
    );
  });
  const waitingWeekly = computed(
    () =>
      detail.value?.status === 'published' &&
      detail.value?.publication?.github &&
      (!currentJob.value || currentJob.value.status === 'skipped'),
  );
  const githubUrl = computed(() =>
    currentJob.value?.status === 'succeeded'
      ? currentJob.value.result?.skill_url ||
        currentJob.value.result?.commit_url ||
        detail.value?.github_url
      : detail.value?.github_url,
  );
  const scheduleText = computed(() => {
    const schedule = settings.value.schedule;
    return schedule
      ? '每周' +
          ['', '一', '二', '三', '四', '五', '六', '日'][schedule.weekday] +
          ' ' +
          schedule.local_time.slice(0, 5) +
          '（' +
          schedule.timezone +
          '）；下次计划：' +
          new Date(schedule.next_run_at).toLocaleString()
      : '';
  });
  let loading = false,
    timer;
  async function loadJobs() {
    if (!editingId.value || loading) return;
    loading = true;
    try {
      const [records, status] = await Promise.all([
        api('/sync-jobs?skill_id=' + editingId.value),
        api('/github/status'),
      ]);
      jobs.value = records;
      settings.value = status;
      jobStatusError.value = '';
    } catch (error) {
      jobStatusError.value = publicError(error);
    } finally {
      loading = false;
    }
  }
  async function retryJob(job) {
    await api('/sync-jobs/' + job.id + '/retry', { method: 'POST' });
    notify('已提交同步重试，请查看同步状态');
    await loadJobs();
  }
  const shouldPoll = computed(
    () =>
      active() &&
      editingId.value &&
      (waitingWeekly.value || jobs.value.some((job) => ['queued', 'running'].includes(job.status))),
  );
  watch(
    shouldPoll,
    (poll) => {
      clearInterval(timer);
      if (poll) timer = setInterval(loadJobs, 15000);
    },
    { immediate: true },
  );
  onUnmounted(() => clearInterval(timer));
  return { loadJobs, retryJob, jobStatusError, currentJob, waitingWeekly, githubUrl, scheduleText };
}
