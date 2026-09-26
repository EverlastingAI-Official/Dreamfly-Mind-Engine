export const statusName = (status) =>
  ({
    draft: '草稿',
    published: '已发布',
    blocked: '已下架',
    completed: '已完成',
    generating: '生成中',
    failed: '失败',
    cancelled: '已取消',
    interrupted: '已中断',
    skipped: '已跳过',
    queued: '排队中',
    running: '执行中',
    succeeded: '成功',
  })[status] || status;
