<template>
  <view class="platform">
    <view class="topbar"><view class="brand" @click="go('explore')"><text class="brand-icon">◈</text><text>云己 <text class="brand-en">DreamFly</text></text></view><view class="top-actions"><text class="muted">{{tr('让思想被理解，让记忆可传承','Let minds connect and memories live on')}}</text><select v-model="locale" class="language-switch" aria-label="界面语言 / Interface language"><option value="zh">中文</option><option value="en">English</option></select><n-button v-if="!auth.user" class="small primary" @click="go('login')">{{tr('登录 / 注册','Sign in / Register')}}</n-button><n-button v-else class="small" @click="go('account')">{{ auth.user.display_name }}</n-button></view></view>
    <view class="shell">
      <view class="sidebar"><text class="nav-label">{{tr('工作空间','WORKSPACE')}}</text><n-button v-for="item in navigation" :key="item.id" class="nav" :class="{selected:view===item.id}" @click="go(item.id)"><text>{{ item.icon }}</text>{{ item.name }}</n-button><view class="sidebar-note">{{tr('Skill 保存你的人格与记忆。','Your personality and memories.')}}<br/>{{tr('模型连接由你自己掌握。','Your own model connections.')}}</view></view>
      <view class="main">
        <view v-if="notice" class="notice" :class="noticeType" role="status">{{ notice }}<n-button class="dismiss" @click="notice=''">×</n-button></view>
        <view v-if="busy" class="loading" role="status">{{tr('正在处理…','Working…')}}</view>
        <explore-skills v-if="sessionReady" ref="explorer" v-show="view==='explore'" :active="view==='explore'" :initial-skill="requestedSkill" @login="exploreLogin" @create="newSkill" @import="run(importSkill)" @edit="id=>run(()=>openSkill(id))" @chat="startExploreChat" @models="go('models')" />

        <template v-if="['login','register','reset'].includes(view)">
          <view class="auth-card panel"><text class="eyebrow">YOUR MIND, YOUR SPACE</text><h1>{{ view==='login'?tr('欢迎回来','Welcome back'):view==='register'?tr('建立你的数字空间','Create your digital space'):tr('重置密码','Reset password') }}</h1><p class="muted">{{ view==='login'?tr('使用邮箱和密码登录，继续你的对话。','Sign in with your email and password.'):tr('验证码将发送到你的邮箱，10 分钟内有效。','A verification code will be emailed to you and is valid for 10 minutes.') }}</p>
            <n-form @submit.prevent="run(submitAuth)"><n-label>{{tr('邮箱','Email')}}<n-input v-model="credentials.email" type="email" autocomplete="email" required placeholder="you@example.com" /></n-label>
              <n-label v-if="view==='register'">{{tr('显示名称','Display name')}}<n-input v-model="credentials.display_name" maxlength="80" required /></n-label>
              <view v-if="view!=='login'" class="row"><n-label class="grow">{{tr('邮箱验证码','Verification code')}}<n-input v-model="credentials.code" inputmode="numeric" maxlength="6" /></n-label><n-button type="button" class="small" :disabled="busy || cooldown>0" @click="run(requestCode)">{{ cooldown>0?tr(`${cooldown}s 后重发`,`Resend in ${cooldown}s`):tr('发送验证码','Send code') }}</n-button></view>
              <n-label>{{ view==='login'?tr('密码','Password'):tr('设置新密码（8–128 位，包含字母和数字）','New password (8–128 characters, letters and digits)') }}<n-input v-model="credentials.password" type="password" :autocomplete="view==='login'?'current-password':'new-password'" required maxlength="128" /></n-label>
              <n-label v-if="view!=='login'">{{tr('确认密码','Confirm password')}}<n-input v-model="credentials.confirm" type="password" autocomplete="new-password" required /></n-label>
              <n-button class="primary full" :disabled="busy" type="submit">{{ view==='login'?tr('登录','Sign in'):view==='register'?tr('完成注册','Register'):tr('重置密码','Reset password') }}</n-button>
            </n-form><view class="row spaced"><n-button class="link" @click="go(view==='register'?'login':'register')">{{ view==='register'?tr('已有账号，去登录','Already registered? Sign in'):tr('注册新账号','Create an account') }}</n-button><n-button class="link" @click="go(view==='reset'?'login':'reset')">{{ view==='reset'?tr('返回登录','Back to sign in'):tr('忘记密码','Forgot password') }}</n-button></view>
          </view>
        </template>

        <template v-else-if="view==='mine'">
          <view class="hero"><text class="eyebrow">MY MIND SKILLS</text><h1>{{tr('你的思想，持续生长。','Your mind, always growing.')}}</h1><p>{{tr('创建、整理并发布你的意识 Skill。每个版本都留下清晰的记录。','Create, organize and publish your Skills. Every version has a clear record.')}}</p><view class="row"><n-button class="primary" @click="newSkill">{{tr('创建 Skill','Create Skill')}}</n-button><n-button @click="run(importSkill)">{{tr('导入 .mind / Skill 包','Import .mind / Skill package')}}</n-button></view></view>
          <view class="section-heading"><h2>{{tr('我的 Skills','My Skills')}}</h2><view class="row"><n-input class="search" v-model="search" :placeholder="tr('搜索名称或 ID','Search name or ID')" @keyup.enter="page=1;run(loadSkills)"/><n-button class="small" @click="page=1;run(loadSkills)">{{tr('搜索','Search')}}</n-button></view></view>
          <view v-if="!skills.length" class="empty panel"><text class="empty-icon">◇</text><h3>{{search?tr('没有找到匹配的 Skill','No matching Skills'):tr('从一个故事开始','Start with a story')}}</h3><p class="muted">{{tr('写下你在乎的事，或导入已有的 .mind 文件。','Write about what matters to you, or import a .mind file.')}}</p></view>
          <view class="cards"><view v-for="skill in skills" :key="skill.id" class="skill-card panel"><view class="row spaced"><text class="avatar">{{skill.name.slice(0,1)}}</text><text class="badge">{{statusName(skill.status)}}</text></view><h3>{{skill.name}}</h3><p>{{skill.description}}</p><text class="muted">{{skill.author}}</text><text class="skill-id">ID: {{skill.id}}</text><view class="row"><n-button class="small" @click="run(()=>copySkill(skill.id))">{{tr('复制 ID','Copy ID')}}</n-button><n-button v-if="skill.status==='published' && skill.publication.listed" class="small" @click="run(()=>copySkill(skillShareUrl(skill.id)))">{{tr('分享链接','Share link')}}</n-button></view><view class="row card-actions"><n-button class="small primary" @click="run(()=>openSkill(skill.id))">{{tr('管理 Skill','Manage Skill')}}</n-button></view></view></view>
          <view class="row pagination"><n-button class="small" :disabled="busy || page===1" @click="page--;run(loadSkills)">{{tr('上一页','Previous')}}</n-button><text>{{tr(`第 ${page} 页 / 共 ${skillTotal} 个`, `Page ${page} / ${skillTotal} Skills`)}}</text><n-button class="small" :disabled="busy || page*24>=skillTotal" @click="page++;run(loadSkills)">{{tr('下一页','Next')}}</n-button></view>
        </template>

        <template v-else-if="view==='edit'">
          <view class="section-heading"><view><text class="eyebrow">SKILL STUDIO</text><h1>{{editingId?'编辑你的 Skill':'创建意识 Skill'}}</h1></view><n-button class="primary" :disabled="busy || submissionIssues.length>0" @click="run(saveSkill)">保存草稿</n-button></view>
          <view class="editor-grid">
            <view>
              <view class="panel">
                <h2>基本信息</h2>
                <view v-if="editingId" class="row"><text class="skill-id">ID: {{editingId}}</text><n-button class="small" @click="run(()=>copySkill(editingId))">{{tr('复制 ID','Copy ID')}}</n-button><n-button v-if="detail?.status==='published' && detail?.publication.listed" class="small" @click="run(()=>copySkill(skillShareUrl(editingId)))">{{tr('分享链接','Share link')}}</n-button></view>
                <n-label>名称<n-input v-model="draft.name" maxlength="100" /></n-label>
                <n-label>{{tr('内容语言','Content language')}}<select v-model="draft.language"><option value="zh-CN">中文</option><option value="en">English</option><option v-if="draft.language && !['zh-CN','en'].includes(draft.language)" :value="draft.language">{{draft.language}}</option></select></n-label>
                <n-label>包名<n-input class="readonly-package" :model-value="draft.slug" readonly /></n-label><p class="readonly-package-note">包名由系统自动分配，创建后不可更改。</p>
                <n-label>人格与表达方式（必填）<n-textarea v-model="draft.persona.instructions" rows="7" maxlength="30000" required placeholder="描述你的性格、说话方式和表达习惯" /></n-label>
                <n-label>自我认知（必填）<n-textarea v-model="draft.persona.self_description" rows="3" maxlength="10000" required placeholder="你如何理解自己，以及你看重什么" /></n-label>
              </view>
              <view class="panel">
                <view class="section-heading"><h2>记忆片段（必填）</h2><n-button class="small" @click="addMemory">添加记忆</n-button></view>
                <p class="muted">草稿仅自己可见。新增记忆默认勾选公开，可在发布前取消。</p>
                <view v-for="(memory,index) in draft.memory.fragments" :key="memory.id" class="memory"><view class="row"><n-input v-model="memory.time" placeholder="时间（可选）"/><n-button class="small danger" @click="removeMemory(index)">移除</n-button></view><n-textarea v-model="memory.content" rows="3" maxlength="10000" required placeholder="记录一段真实经历…" /></view>
                <p v-if="!draft.memory.fragments.length" class="muted">还没有记忆片段。</p>
              </view>
              <view class="panel">
                <h2>图片素材</h2><p class="muted">支持 PNG / JPEG / WebP，每个文件不超过 10 MB。</p>
                <n-button class="small" @click="run(()=>uploadAsset('image'))">上传图片</n-button>
                <view v-for="(reference,key) in imageAssets" :key="key" class="row spaced"><text>{{reference.split('/')[1]}}</text><n-button class="small" @click="delete draft.assets[key]">移除图片</n-button></view>
              </view>
              <view class="panel">
                <h2>声音素材</h2><p class="muted">支持 WAV / OGG / MP3，每个文件不超过 10 MB。声音文件仅作为素材保存。</p>
                <n-button class="small" @click="run(()=>uploadAsset('audio'))">上传声音</n-button>
                <view v-for="(reference,key) in audioAssets" :key="key" class="row spaced"><text>{{reference.split('/')[1]}}</text><n-button class="small" @click="delete draft.assets[key]">移除声音</n-button></view>
              </view>
            </view>
            <view><view class="panel sticky">
              <h2>发布预览</h2><p>名称和人格会随 Skill 发布。请确认下方公开范围。</p>
              <n-label class="check"><n-input type="checkbox" v-model="publication.listed" @change="listingChanged"/>允许出现在公共目录</n-label>
              <n-label class="check"><n-input type="checkbox" v-model="publication.chat" :disabled="!publication.listed"/>允许其他用户交互</n-label>
              <n-label class="check"><n-input type="checkbox" v-model="publication.download" :disabled="!publication.listed"/>允许下载</n-label>
              <h3>可公开使用的记忆</h3><n-label v-for="m in draft.memory.fragments" :key="m.id" class="check"><n-input type="checkbox" :value="m.id" v-model="publication.memory_ids"/><text>{{m.time}} {{m.content.slice(0,90)}}</text></n-label>
              <p v-if="publication.download" class="muted">允许下载的最新版本每周同步至 GitHub，全部图片和声音素材随包分发。</p>
              <view class="publication-validation"><h3>发布合规确认</h3><p v-for="issue in submissionIssues" :key="issue" class="validation-error">{{issue}}</p><p v-if="!submissionIssues.length" class="validation-success">必填内容已填写完整。</p><n-label class="check"><n-input type="checkbox" v-model="complianceConfirmed"/>我确认拥有这些内容的使用与发布授权，并同意当前选择的公开范围。</n-label></view>
              <p v-if="detail?.published_version_id" class="muted">当前版本 {{detail.versions?.find(v=>v.id===detail.published_version_id)?.version}}；提交修改后自动生成新版本。</p>
              <n-button class="primary full" :disabled="busy || submissionIssues.length>0 || !complianceConfirmed" @click="run(publishSkill)">{{detail?.published_version_id?'上传更新':'上传记忆'}}</n-button>
              <n-button v-if="editingId" class="full" @click="run(unpublishSkill)">从平台下架</n-button>
              <p v-if="waitingWeekly" class="muted">GitHub · 等待每周同步。{{scheduleText}}</p>
              <view v-if="currentJob" class="panel"><p>GitHub · {{statusName(currentJob.status)}} · {{currentJob.version}}</p><p v-if="currentJob.last_error">{{currentJob.last_error}}</p><p v-if="currentJob.result?.reason">{{currentJob.result.reason}}</p><a v-if="currentJob.result?.commit_url" :href="currentJob.result.commit_url" target="_blank" rel="noopener">查看提交</a><n-button v-if="currentJob.status==='failed'" class="small" @click="run(()=>retryJob(currentJob))">重试同步</n-button></view><p v-if="jobStatusError" class="validation-error">{{jobStatusError}}</p>
              <n-button v-if="detail?.published_version_id" class="full" @click="run(()=>startChat(detail))">与已发布版本对话</n-button>
            </view></view>
          </view>
        </template>
        <template v-else-if="view==='chat'">
          <text class="eyebrow">MINDCOPY CONVERSATIONS</text><h1>让对话持续。</h1><view class="chat-grid"><view class="panel"><h3>我的会话</h3><n-button v-for="c in conversations" :key="c.id" class="conversation-item" :class="{selected:c.id===currentConversation?.id}" @click="run(()=>openConversation(c))">{{c.title}}<small>{{c.model_config.model}}</small></n-button><p v-if="!conversations.length" class="muted">从 Skill 详情页开始一段对话。</p></view>
            <view class="panel chat-panel"><template v-if="currentConversation"><view class="row spaced"><h2>{{currentConversation.title}}</h2><view class="row"><n-button class="small" @click="run(renameConversation)">重命名</n-button><n-button class="small danger" :disabled="generating" @click="run(deleteConversation)">删除</n-button></view></view><view class="row"><select class="grow" v-model="selectedProfile"><option v-for="p in profiles" :value="p.id" :key="p.id">{{p.name}} · {{p.model}}</option></select><n-button class="small" :disabled="generating" @click="run(switchModel)">切换后续模型</n-button></view><p class="muted">当前：{{currentConversation.model_config.model}} · 会话记忆不会自动写入公开 Skill。</p><view class="messages" ref="messageBox"><view v-for="m in messages" :key="m.id" class="message" :class="m.role"><text class="message-role">{{m.role==='user'?'你':'MindCopy'}}</text><view class="message-content">{{m.content || (m.status==='generating'?'正在思考…':'未生成文本')}}</view><small v-if="m.role==='assistant'" class="muted">{{statusName(m.status)}} · {{usageText(m.usage)}}</small></view></view><n-form @submit.prevent="chat"><n-textarea v-model="input" rows="3" maxlength="10000" placeholder="说说你的想法…" :disabled="generating"/><view class="row spaced"><text class="muted">保持原文 · 私有会话</text><n-button v-if="generating" type="button" @click="run(cancelGeneration)">停止生成</n-button><n-button v-else class="primary" type="submit" :disabled="!input.trim()">发送</n-button></view></n-form></template><view v-else class="empty"><text class="empty-icon">◎</text><h3>选择一段会话</h3><n-button @click="go('explore')">探索 Skills</n-button></view></view></view>
        </template>

        <template v-else-if="view==='models'">
          <text class="eyebrow">YOUR MODELS</text><h1>选择你的思考引擎。</h1>
          <p class="lead">选择厂商，填写 API Key，再选择模型。密钥仅由服务端加密保存。</p>
          <view class="editor-grid">
            <view class="panel">
              <view class="section-heading"><h2>{{modelForm.id?'编辑连接':'新增模型连接'}}</h2><n-button class="small" :disabled="busy" @click="resetModel">新建</n-button></view>
              <n-label>连接名称<n-input v-model="modelForm.name" :disabled="busy" placeholder="我的 DeepSeek" /></n-label>
              <n-label>厂商<select v-model="modelForm.provider" :disabled="busy" @change="providerChanged"><option v-for="p in selectableProviders" :value="p.id" :key="p.id" :disabled="p.id==='custom'">{{p.name}}</option></select></n-label>
              <n-label>API 地址<n-input :model-value="modelForm.base_url" readonly /></n-label>
              <n-label>API Key<n-input v-model="modelForm.api_key" :disabled="busy" type="password" autocomplete="off" :placeholder="modelForm.api_key_configured?'已保存；留空保留原密钥':'输入 API Key 后获取模型'" @input="modelKeyChanged" @blur="autoLoadModels" /></n-label>
              <n-label>模型<select v-model="modelForm.model" :disabled="busy || modelsLoading || !modelList.length"><option value="" disabled>{{modelsLoading?'正在获取模型…':modelList.length?'请选择模型':'请先获取模型列表'}}</option><option v-for="m in modelList" :key="m.id" :value="m.id">{{m.name===m.id?m.id:m.name+' · '+m.id}}</option></select></n-label>
              <view class="row"><n-button class="small" :disabled="busy || modelsLoading || !canLoadModels" @click="loadModelList">{{modelsLoading?'正在获取…':modelList.length?'刷新模型列表':'获取模型列表'}}</n-button><text class="muted">无需先保存连接</text></view>
              <p v-if="modelListError" class="model-list-error" role="alert">{{modelListError}}</p>
              <p v-else-if="modelsLoaded && !modelList.length" class="muted">此 API Key 暂未返回可用的对话模型，请检查厂商账号权限后重试。</p>
              <n-label class="check"><n-input v-model="modelForm.consent" :disabled="busy" type="checkbox"/>同意将对话及获准使用的人格、记忆发送至此厂商</n-label>
              <p class="muted">测试连接会发送最小请求，可能产生少量模型费用。</p>
              <view class="row"><n-button class="primary" :disabled="busy || modelsLoading || !modelForm.model" @click="run(saveModel)">保存配置</n-button><n-button :disabled="busy || modelsLoading || !modelForm.model || !canLoadModels || !modelForm.consent" @click="run(testModel)">保存并测试</n-button><n-button v-if="modelForm.api_key_configured" :disabled="busy" class="danger" @click="run(clearKey)">清除密钥</n-button></view>
            </view>
            <view><view v-for="p in profiles" :key="p.id" class="panel"><view class="row spaced"><h3>{{p.name}}</h3><text class="badge">{{defaultProfile===p.id?'默认连接':p.verified_at?'已验证':'未验证'}}</text></view><p>{{p.model}}</p><p class="muted">{{p.provider}} · {{p.api_key_configured?'已保存密钥':'缺少密钥'}}</p><view class="row"><n-button class="small" :disabled="busy" @click="editModel(p)">编辑</n-button><n-button class="small" :disabled="busy || !p.verified_at" @click="run(()=>setDefault(p))">设为默认</n-button><n-button class="small danger" :disabled="busy" @click="run(()=>deleteModel(p))">删除</n-button></view></view></view>
          </view>
        </template>
        <template v-else-if="view==='github'">
          <text class="eyebrow">GITHUB SYNC</text><h1>让每个版本都有归处。</h1><p class="lead">允许下载的最新版本每周提交至平台仓库。服务端查询、筛选和下载即时可用，不受同步影响。</p>
          <view v-if="!githubSettings.configured" class="panel"><h3>平台同步尚未就绪</h3><p>{{githubSettings.message}}</p></view>
          <view v-else class="panel"><p>每周同步已启用。{{scheduleText}}</p><n-button v-if="auth.user?.role==='admin'" @click="run(checkGithub)">检查仓库连接</n-button></view>
          <p v-if="githubSettings.schedule?.last_error" class="validation-error">{{githubSettings.schedule.last_error}}</p>
          <view class="panel"><h2>{{adminSync?'平台每周批次':'我的每周批次'}}</h2>
            <n-label v-if="auth.user?.role==='admin'" class="check"><n-input type="checkbox" v-model="adminSync" @change="jobPage=1;run(loadJobs)"/>查看平台全部任务</n-label>
            <view v-for="batch in syncBatches" :key="batch.id"><p>{{new Date(batch.scheduled_for).toLocaleString()}} · 共 {{batch.total}} 项 · 成功 {{batch.succeeded}} · 失败 {{batch.failed}} · 跳过 {{batch.skipped}} · 处理中 {{batch.pending}}</p><n-button class="small" @click="jobFilters.batch_id=batch.id;jobPage=1;run(loadJobs)">查看批次任务</n-button></view>
            <p v-if="!syncBatches.length" class="muted">尚无批次记录。</p>
          </view>
          <view class="panel row"><n-label>状态<select v-model="jobFilters.status"><option value="">全部</option><option v-for="state in ['queued','running','succeeded','failed','skipped']" :key="state" :value="state">{{statusName(state)}}</option></select></n-label><n-label>Skill ID<n-input v-model="jobFilters.skill_id"/></n-label><n-label>批次 ID<n-input v-model="jobFilters.batch_id"/></n-label><n-label>开始日期<n-input type="date" v-model="jobFilters.from"/></n-label><n-label>结束日期（不含）<n-input type="date" v-model="jobFilters.to"/></n-label><n-button class="small" @click="jobPage=1;run(loadJobs)">筛选</n-button></view>
          <p v-if="jobStatusError" class="validation-error">{{jobStatusError}}</p>
          <view class="section-heading"><h2>同步记录</h2><n-button class="small" @click="run(loadJobs)">刷新状态</n-button></view><view v-for="j in jobs" :key="j.id" class="panel"><view class="row spaced"><text class="badge">{{statusName(j.status)}}</text><text class="muted">{{new Date(j.created_at).toLocaleString()}}</text></view><p>版本 {{j.version}}</p><p v-if="j.last_error">{{j.last_error}}</p><p v-if="j.result?.reason">{{j.result.reason}}</p><view class="row"><a v-if="j.result?.commit_url" :href="j.result.commit_url" target="_blank" rel="noopener">查看提交</a><n-button v-if="j.status==='failed'" class="small" @click="run(()=>retryJob(j))">重试</n-button></view></view><p v-if="!jobs.length" class="muted">暂无符合条件的同步记录。</p><view class="row"><n-button class="small" :disabled="jobPage===1" @click="jobPage--;run(loadJobs)">上一页</n-button><text>第 {{jobPage}} 页</text><n-button class="small" :disabled="jobs.length<50" @click="jobPage++;run(loadJobs)">下一页</n-button></view>
        </template>

        <template v-else-if="view==='account'">
          <h1>账号设置</h1><view class="panel narrow"><h2>{{auth.user?.display_name}}</h2><p>{{auth.user?.email}}</p><n-label>当前密码<n-input v-model="passwords.old_password" type="password" autocomplete="current-password"/></n-label><n-label>新密码（8–128 位，包含字母和数字）<n-input v-model="passwords.password" type="password" autocomplete="new-password"/></n-label><n-button class="primary" @click="run(changePassword)">修改密码并退出所有设备</n-button><view class="row separated"><n-button @click="run(()=>logout(false))">退出当前账号</n-button><n-button @click="run(()=>logout(true))">退出所有设备</n-button></view></view>
        </template>
        <template v-else-if="view==='admin'"><h1>管理空间</h1><view class="panel"><h2>下架 Skill</h2><n-label>Skill ID<n-input v-model="adminSkill" /></n-label><n-button class="danger" @click="run(blockSkill)">管理下架</n-button></view><view class="panel" v-for="u in users" :key="u.id"><view class="row spaced"><text>{{u.display_name}} · {{u.email}} · {{u.status}}</text><n-button class="small" :disabled="u.id===auth.user.id" @click="run(()=>toggleUser(u))">{{u.status==='active'?'停用':'恢复'}}</n-button></view></view></template>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import ExploreSkills from '../../components/ExploreSkills.vue'
import { locale, tr, copyText, skillShareUrl, publicError } from '../../services/locale.js'
import { NInput, NTextarea, NButton, NForm, NLabel } from '../../components/native.js'
import { onLoad } from '@dcloudio/uni-app'
import { api, auth, restoreSession, sendMessage, chooseFile } from '../../services/platform.js'
import { emptyMind, skillSlug, defaultPublication, publicationSettings, assetMaxBytes, skillSubmissionIssues } from '../../../packages/mind-format/index.js'
const view=ref('explore'),busy=ref(false),notice=ref(''),noticeType=ref(''),search=ref(''),page=ref(1),skills=ref([]),detail=ref(null),editingId=ref(''),draft=ref(emptyMind())
const skillTotal=ref(0),sessionReady=ref(false),explorer=ref(null)
let afterLogin=null
function exploreLogin(action){afterLogin=action;view.value='login';notice.value=tr('请先登录，完成后将返回刚才的 Skill。','Please sign in to return to your Skill.')}
async function copySkill(value){await copyText(value);notify(tr('已复制，可分享给其他人。','Copied. Ready to share.'))}
function startExploreChat(skill,profile){selectedProfile.value=profile;run(()=>startChat(skill))}
const publication=ref(defaultPublication(draft.value)),newSkillId=ref(''),draftRevision=ref(0),pendingSubmission=ref(null)
const complianceConfirmed=ref(false),submissionIssues=computed(()=>skillSubmissionIssues(draft.value))
watch([draft,publication],()=>{complianceConfirmed.value=false;pendingSubmission.value=null},{deep:true,flush:'sync'})
const imageAssets=computed(()=>Object.fromEntries(Object.entries(draft.value.assets).filter(([,ref])=>/\.(png|jpe?g|webp)$/i.test(ref))))
const audioAssets=computed(()=>Object.fromEntries(Object.entries(draft.value.assets).filter(([,ref])=>/\.(wav|ogg|mp3)$/i.test(ref))))
const profiles=ref([]),defaultProfile=ref(''),selectedProfile=ref(''),providerCatalog=ref([]),modelList=ref([])
const modelForm=ref({}),conversations=ref([]),currentConversation=ref(null),messages=ref([]),input=ref(''),generating=ref(false),generationId=ref(''),messageBox=ref(null)
const modelsLoading=ref(false),modelsLoaded=ref(false),modelListError=ref('')
const canLoadModels=computed(()=>!!(modelForm.value.api_key?.trim()||modelForm.value.api_key_configured))
const selectableProviders=computed(()=>providerCatalog.value.filter(p=>p.id!=='custom'||modelForm.value.provider==='custom'))
let modelListRequest=0
const credentials=ref({email:'',password:'',confirm:'',display_name:'',code:'',challenge_id:''}),cooldown=ref(0),passwords=ref({old_password:'',password:''})
const githubSettings=ref({configured:false}),jobs=ref([]),jobStatusError=ref(''),users=ref([]),adminSkill=ref('')
const syncBatches=ref([]),adminSync=ref(false),jobPage=ref(1),jobFilters=ref({status:'',skill_id:'',batch_id:'',from:'',to:''})
const currentJob=computed(()=>{
  const target=githubSettings.value.target;
  return jobs.value.find(j=>j.skill_id===editingId.value&&j.version_id===detail.value?.published_version_id&&
    (!target||(j.target?.owner?.toLowerCase()===target.owner&&j.target?.repo?.toLowerCase()===target.repo&&j.target?.branch===target.branch)))
})
const waitingWeekly=computed(()=>detail.value?.status==='published'&&detail.value?.publication?.github&&(!currentJob.value||currentJob.value.status==='skipped'))
const scheduleText=computed(()=>{const s=githubSettings.value.schedule;return s?'每周'+['','一','二','三','四','五','六','日'][s.weekday]+' '+s.local_time.slice(0,5)+'（'+s.timezone+'）；下次计划：'+new Date(s.next_run_at).toLocaleString():''})
const navigation=computed(()=>[{id:'explore',name:tr('探索思想','Explore minds'),icon:'◇'},{id:'mine',name:tr('我的 Skills','My Skills'),icon:'◈'},{id:'chat',name:tr('MindCopy 对话','Conversations'),icon:'◎'},{id:'models',name:tr('模型连接','Model connections'),icon:'⚙'},{id:'github',name:tr('GitHub 同步','GitHub sync'),icon:'↗'},...(auth.user?.role==='admin'?[{id:'admin',name:tr('管理空间','Administration'),icon:'▣'}]:[])])
const usageText=u=>!u?'用量未知':`输入 ${u.prompt_tokens??u.input_tokens??u.promptTokenCount??'未知'} / 输出 ${u.completion_tokens??u.output_tokens??u.candidatesTokenCount??'未知'} tokens`
const cryptoId=()=>crypto.randomUUID()
const statusName=s=>({draft:'草稿',published:'已发布',blocked:'已下架',completed:'已完成',generating:'生成中',failed:'失败',cancelled:'已取消',interrupted:'已中断',skipped:'已跳过',queued:'排队中',running:'执行中',succeeded:'成功',awaiting_merge:'等待合并',closed:'PR 已关闭'}[s]||s)
function notify(message,type='success'){notice.value=message;noticeType.value=type}
async function run(fn){if(busy.value)return;busy.value=true;notice.value='';try{await fn()}catch(e){notify(locale.value==='en'&&e.code?publicError(e):e.message+(e.details?'：'+JSON.stringify(e.details):''),'error')}finally{busy.value=false}}
function validatePassword(value){if(value.length<8||value.length>128||!/[A-Za-z]/.test(value)||!/[0-9]/.test(value))throw new Error(tr('密码须为 8–128 位，且包含字母和数字','Use 8–128 characters including letters and digits'))}
function requireLogin(){if(auth.user)return true;view.value='login';notify(tr('请先登录','Please sign in'),'info');return false}
async function go(next){if(generating.value){notify('请先停止当前生成，再切换页面','info');return}if(!['login','register','reset'].includes(next))afterLogin=null;if(!['explore','login','register','reset'].includes(next)&&!requireLogin())return;view.value=next;notice.value='';page.value=1;await run(()=>loadView(next))}
async function loadView(next){if(next==='mine')await loadSkills();if(next==='models'){providerCatalog.value=await api('/model-providers');await loadProfiles();resetModel()}if(next==='chat'){await loadProfiles();conversations.value=await api('/conversations')}if(next==='github'){githubSettings.value=await api('/github/status');await loadJobs()}if(next==='admin')users.value=await api('/admin/users')}
async function loadSkills(){const result=await api(`/skills?scope=mine&search=${encodeURIComponent(search.value)}&page=${page.value}`);skills.value=result.items;skillTotal.value=result.total}
async function requestCode(){const data=await api('/auth/email-codes',{method:'POST',body:{email:credentials.value.email,purpose:view.value==='register'?'register':'reset_password'}});credentials.value.challenge_id=data.challenge_id;cooldown.value=60;notify(tr('验证码请求已受理，请检查邮箱','Verification code requested. Please check your inbox.'))}
async function submitAuth(){const c=credentials.value;if(view.value!=='login')validatePassword(c.password);if(view.value!=='login'&&c.password!==c.confirm)throw new Error(tr('两次输入的密码不一致','Passwords do not match'));if(view.value==='login'){Object.assign(auth,await api('/auth/login',{method:'POST',body:c}));credentials.value.password='';if(afterLogin){const resume=afterLogin;afterLogin=null;view.value='explore';await resume()}else{view.value='mine';await loadSkills()}}else{await api(view.value==='register'?'/auth/register':'/auth/reset-password',{method:'POST',body:c});view.value='login';credentials.value.password='';credentials.value.confirm='';notify(tr('操作成功，请使用邮箱密码登录','Success. Please sign in with your email and password.'))}}
function newSkill(){if(!requireLogin())return;editingId.value='';newSkillId.value=cryptoId();draftRevision.value=0;pendingSubmission.value=null;detail.value=null;jobStatusError.value='';draft.value=emptyMind(skillSlug(newSkillId.value));draft.value.name=`${auth.user.display_name}的mindcopy`;draft.value.persona.instructions='';draft.value.persona.self_description='';draft.value.memory.fragments=[{id:cryptoId(),time:'',content:''}];publication.value=defaultPublication(draft.value);view.value='edit'}
async function importSkill(){if(!requireLogin())return;const file=await chooseFile('.mind,.js,.json,.md,.zip');if(!file)return;const form=new FormData();form.append('file',file);const result=await api('/skills/import',{method:'POST',body:form});newSkill();draft.value={...result.mind,slug:draft.value.slug,version:'1.0.0'};publication.value=defaultPublication(draft.value);notify(result.warnings.join(' ')||'已导入为编辑内容，请检查后保存')}
async function openSkill(skillId){detail.value=await api(`/skills/${skillId}`);if(detail.value.owner_id===auth.user?.id){editingId.value=skillId;draft.value=JSON.parse(JSON.stringify(detail.value.draft));publication.value={...defaultPublication(draft.value),...detail.value.draft_publication};draftRevision.value=detail.value.revision;listingChanged();view.value='edit';await loadJobs()}else{view.value='explore';await explorer.value.openDetail(skillId)}}
async function saveSkill(){
  if(submissionIssues.value.length)throw new Error(submissionIssues.value.join('；'));
  const result=await api(editingId.value?`/skills/${editingId.value}`:'/skills',{method:editingId.value?'PATCH':'POST',body:{...(!editingId.value?{id:newSkillId.value}:{}),revision:draftRevision.value,content:draft.value,publication:publicationSettings(draft.value,publication.value)}});
  editingId.value=result.id;draftRevision.value=result.revision;pendingSubmission.value=null;
  detail.value=await api(`/skills/${result.id}`);notify('草稿已保存');
}
async function publishSkill(){
  if(!complianceConfirmed.value)throw new Error('请确认内容授权及公开范围');
  const skill=editingId.value||newSkillId.value;
  if(!pendingSubmission.value)pendingSubmission.value=JSON.parse(JSON.stringify({request_id:cryptoId(),revision:draftRevision.value,content:draft.value,publication:publicationSettings(draft.value,publication.value),compliance_confirmed:true}));
  const result=await api(`/skills/${skill}/submit`,{method:'POST',body:pendingSubmission.value});
  editingId.value=result.id;
  detail.value=await api(`/skills/${result.id}`);
  pendingSubmission.value=null;
  draft.value=JSON.parse(JSON.stringify(detail.value.draft));draftRevision.value=detail.value.revision;
  publication.value={...defaultPublication(draft.value),...detail.value.draft_publication};complianceConfirmed.value=false;
  notify(result.unchanged?'内容未变化，已保留原版本':result.sync_policy==='weekly'?'已上传，将在每周同步时处理':'已上传');
  try{await loadJobs()}catch{jobStatusError.value='内容已保存，暂时无法读取同步状态'}
}
function listingChanged(){if(!publication.value.listed){publication.value.chat=false;publication.value.download=false}}
function addMemory(){const memory={id:cryptoId(),time:'',content:''};draft.value.memory.fragments.push(memory);publication.value.memory_ids.push(memory.id)}
function removeMemory(index){const [memory]=draft.value.memory.fragments.splice(index,1);publication.value.memory_ids=publication.value.memory_ids.filter(id=>id!==memory.id)}
async function unpublishSkill(){await api(`/skills/${editingId.value}/unpublish`,{method:'POST'});detail.value=await api(`/skills/${editingId.value}`);draftRevision.value=detail.value.revision;pendingSubmission.value=null;notify('已从平台下架；已分发到 GitHub 的历史不会自动删除')}
async function uploadAsset(kind){const extension=kind==='image'?/\.(png|jpe?g|webp)$/i:/\.(wav|ogg|mp3)$/i;const file=await chooseFile(kind==='image'?'.png,.jpg,.jpeg,.webp':'.wav,.ogg,.mp3');if(!file)return;if(file.size>assetMaxBytes)throw new Error('每个素材文件不能超过 10 MB');if(!extension.test(file.name))throw new Error(kind==='image'?'请选择 PNG、JPEG 或 WebP 图片':'请选择 WAV、OGG 或 MP3 声音文件');const form=new FormData();form.append('kind',kind);form.append('file',file);const a=await api('/assets',{method:'POST',body:form});draft.value.assets[`${kind}-${a.id}`]=a.reference;notify('素材已上传，请保存草稿')}
async function loadProfiles(){const data=await api('/model-profiles');profiles.value=data.profiles;defaultProfile.value=data.default_profile_id;if(!profiles.value.some(x=>x.id===selectedProfile.value))selectedProfile.value=defaultProfile.value||''}
async function startChat(s){if(!auth.user){exploreLogin(()=>startChat(s));return}await loadProfiles();if(!selectedProfile.value)throw new Error(tr('请先在模型连接中配置、测试并设置默认连接','Configure, test and set a default model connection first.'));const result=await api(`/mindcopies/${s.id}/sessions`,{method:'POST',body:{version_id:s.published_version_id,profile_id:selectedProfile.value}});conversations.value=await api('/conversations');await openConversation(conversations.value.find(x=>x.id===result.id));view.value='chat'}
async function openConversation(c){if(generating.value)throw new Error('请先停止当前生成');currentConversation.value=c;selectedProfile.value=c.profile_id||'';messages.value=await api(`/conversations/${c.id}/messages`)}
async function chat(){if(generating.value||!input.value.trim())return;const value=input.value;input.value='';generating.value=true;notice.value='';messages.value.push({id:cryptoId(),role:'user',content:value,status:'completed'});let assistant;
  try{await sendMessage(currentConversation.value.id,value,(event,data)=>{if(event==='message.start'){generationId.value=data.id;assistant={id:data.id,role:'assistant',content:'',status:'generating'};messages.value.push(assistant)}if(event==='message.delta'){const m=messages.value.find(x=>x.id===generationId.value);if(m)m.content+=data.text}if(event==='message.failed')notify(data.message||'生成失败','error');nextTick(()=>{const el=messageBox.value?.$el||messageBox.value;if(el)el.scrollTop=el.scrollHeight})})}catch(e){notify(e.message,'error')}finally{generating.value=false;generationId.value='';try{messages.value=await api(`/conversations/${currentConversation.value.id}/messages`)}catch(e){notify(e.message,'error')}}}
async function cancelGeneration(){if(generationId.value)await api(`/conversations/${currentConversation.value.id}/messages/${generationId.value}/cancel`,{method:'POST'})}
async function switchModel(){await api(`/conversations/${currentConversation.value.id}/model-profile`,{method:'PUT',body:{profile_id:selectedProfile.value}});conversations.value=await api('/conversations');currentConversation.value=conversations.value.find(x=>x.id===currentConversation.value.id);notify('后续消息将使用所选模型')}
async function renameConversation(){const title=window.prompt('新的会话名称',currentConversation.value.title);if(!title)return;await api(`/conversations/${currentConversation.value.id}`,{method:'PATCH',body:{title}});currentConversation.value.title=title;conversations.value=await api('/conversations')}
async function deleteConversation(){if(!window.confirm('删除此会话及其消息？'))return;await api(`/conversations/${currentConversation.value.id}`,{method:'DELETE'});currentConversation.value=null;messages.value=[];conversations.value=await api('/conversations')}
function invalidateModels(){modelListRequest++;modelsLoading.value=false;modelsLoaded.value=false;modelListError.value='';modelList.value=[]}
function resetModel(){invalidateModels();const p=providerCatalog.value.find(x=>x.id==='deepseek');modelForm.value={name:'',provider:p?.id||'deepseek',protocol:p?.protocol,base_url:p?.base_url||'',model:'',api_key:'',consent:false}}
function providerChanged(){invalidateModels();const p=providerCatalog.value.find(x=>x.id===modelForm.value.provider);Object.assign(modelForm.value,{base_url:p.base_url,protocol:p.protocol,model:'',api_key:'',api_key_configured:false,consent:false})}
function modelKeyChanged(){invalidateModels();modelForm.value.model=''}
function editModel(p){invalidateModels();modelForm.value={...JSON.parse(JSON.stringify(p)),api_key:''};modelList.value=[{id:p.model,name:p.model}];autoLoadModels()}
async function saveModel(action){const f=modelForm.value;if(!f.model)throw new Error('请先获取模型列表并选择模型');const data=await api(f.id?`/model-profiles/${f.id}`:'/model-profiles',{method:f.id?'PATCH':'POST',body:{...f,api_key:f.api_key.trim(),api_key_action:action|| (f.api_key.trim()?'replace':'keep')}});modelForm.value={...data,api_key:''};await loadProfiles();notify('配置已保存，请测试连接')}
async function testModel(){await saveModel();await api(`/model-profiles/${modelForm.value.id}/test`,{method:'POST'});await loadProfiles();modelForm.value={...profiles.value.find(x=>x.id===modelForm.value.id),api_key:''};notify('连接测试通过，可设为默认')}
async function clearKey(){const saved=profiles.value.find(p=>p.id===modelForm.value.id);await api(`/model-profiles/${saved.id}`,{method:'PATCH',body:{...saved,api_key_action:'clear'}});await loadProfiles();editModel(profiles.value.find(p=>p.id===saved.id));notify('密钥已清除')}
function autoLoadModels(){if(canLoadModels.value&&!modelsLoaded.value&&!modelsLoading.value)loadModelList()}
async function loadModelList(){
  if(!canLoadModels.value||modelsLoading.value)return
  const request=++modelListRequest,f=modelForm.value;modelsLoading.value=true;modelListError.value=''
  try{
    const models=await api(`/model-providers/${f.provider}/models`,{method:'POST',body:{api_key:f.api_key.trim(),...(f.id?{profile_id:f.id}:{})}})
    if(request!==modelListRequest)return
    modelList.value=models;modelsLoaded.value=true
    if(!models.some(m=>m.id===f.model))f.model=''
  }catch(e){if(request===modelListRequest)modelListError.value=e.message+'；请检查 API Key 或网络后重试。'}
  finally{if(request===modelListRequest)modelsLoading.value=false}
}
async function setDefault(p){await api('/users/me/default-model-profile',{method:'PUT',body:{profile_id:p.id}});await loadProfiles();notify('已设为默认连接')}
async function deleteModel(p){if(!window.confirm('删除连接后，使用此连接的会话需要重新选择模型。继续？'))return;await api(`/model-profiles/${p.id}`,{method:'DELETE'});await loadProfiles();if(modelForm.value.id===p.id)resetModel()}
async function checkGithub(){const result=await api('/admin/github/check',{method:'POST'});notify(result.message)}
async function loadJobs(){
  const admin=view.value==='github'&&adminSync.value&&auth.user?.role==='admin';
  const filters=view.value==='edit'?{skill_id:editingId.value}:{...jobFilters.value,page:String(jobPage.value)};
  const search=new URLSearchParams(Object.entries(filters).filter(([,value])=>value)).toString();
  const [records,settings,batches]=await Promise.all([api((admin?'/admin/sync-jobs':'/sync-jobs')+'?'+search),api('/github/status'),view.value==='github'?api(admin?'/admin/github/batches':'/github/batches'):Promise.resolve([])]);
  jobs.value=records;githubSettings.value=settings;syncBatches.value=batches;jobStatusError.value=''
}
async function retryJob(j){await api((view.value==='github'&&adminSync.value?'/admin':'')+`/sync-jobs/${j.id}/retry`,{method:'POST'});await loadJobs()}
async function logout(all){await api(all?'/auth/logout-all':'/auth/logout',{method:'POST'});auth.user=null;auth.csrf='';view.value='login';currentConversation.value=null;messages.value=[]}
async function changePassword(){validatePassword(passwords.value.password);await api('/auth/change-password',{method:'POST',body:passwords.value});auth.user=null;auth.csrf='';passwords.value={old_password:'',password:''};view.value='login';notify('密码已修改，请重新登录')}
async function blockSkill(){await api(`/admin/skills/${adminSkill.value}/unpublish`,{method:'POST'});notify('已下架')}
async function toggleUser(u){await api(`/admin/users/${u.id}/status`,{method:'PATCH',body:{status:u.status==='active'?'disabled':'active'}});users.value=await api('/admin/users')}
let requestedView='explore',requestedSkill='';onLoad(options=>{if(options?.view)requestedView=options.view;if(options?.skill){requestedSkill=options.skill;requestedView='explore'}})
const interval=setInterval(()=>{if(cooldown.value>0)cooldown.value--},1000)
let pollingJobs=false
const jobInterval=setInterval(async()=>{
  if(pollingJobs||!auth.user||!['edit','github'].includes(view.value)||(view.value==='edit'&&!waitingWeekly.value&&!jobs.value.some(j=>['queued','running'].includes(j.status))))return
  pollingJobs=true
  try{await loadJobs()}catch{jobStatusError.value='暂时无法刷新同步状态，请到 GitHub 同步页重试'}finally{pollingJobs=false}
},15000)
onUnmounted(()=>{clearInterval(interval);clearInterval(jobInterval)})
onMounted(()=>run(async()=>{await restoreSession();view.value=auth.user?requestedView:['register','reset','login'].includes(requestedView)?requestedView:'explore';sessionReady.value=true;await loadView(view.value)}))
</script>
