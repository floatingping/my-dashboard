import { api, fmtDuration, fmtTime, query, RUN_KIND } from "../common.js";
import { bootPage, notify } from "../components.js";

// log 每行開頭是 [時間] 圖示，依圖示上色；沒有開頭的行延續上一行的顏色
const LINE_STYLES = [
  { mark: "💬", cls: "text-slate-100" },
  { mark: "🔧", cls: "text-amber-300" },
  { mark: "✅", cls: "text-emerald-300/80" },
  { mark: "❌", cls: "text-red-400" },
  { mark: "💥", cls: "text-red-400" },
  { mark: "📊", cls: "text-sky-300" },
  { mark: "📋", cls: "text-violet-300" },
  { mark: "▶", cls: "text-sky-300" },
  { mark: "■", cls: "text-slate-400" }
];
const STAMP_RE = /^\[\d{1,2}:\d{2}:\d{2}\] (\S+)/;

const RunPage = {
  data() {
    return { runId: Number(query("id")), run: null, text: "", offset: 0, loading: true, notFound: false, autoScroll: true, showPrompt: false };
  },
  computed: {
    boardLink() {
      return this.run ? `/board?id=${this.run.board_id}` : "/";
    },
    ticketLink() {
      return this.run?.ticket_id ? `/ticket?id=${this.run.ticket_id}` : "";
    },
    kindLabel() {
      return RUN_KIND[this.run?.kind] ?? "";
    },
    lines() {
      let current = "text-slate-400";
      return this.text.split("\n").map((line) => {
        const match = line.match(STAMP_RE);
        if (match) current = LINE_STYLES.find((s) => match[1].startsWith(s.mark))?.cls ?? "text-slate-300";
        return { text: line, cls: current };
      });
    },
    promptLabel() {
      return this.showPrompt ? "收起" : "展開";
    }
  },
  async mounted() {
    await this.loadRun();
    if (!this.notFound) this.poll();
  },
  unmounted() {
    clearTimeout(this.timer);
  },
  methods: {
    async loadRun() {
      try {
        this.run = await api(`/runs/${this.runId}`);
        document.title = `run #${this.run.id} · Agent 看板`;
      } catch (err) {
        if (err.status === 404 || err.status === 400) this.notFound = true;
        else notify(err.message, "error");
      } finally {
        this.loading = false;
      }
    },
    // 執行中每 1.5 秒讀一次新的 log；結束後讀完剩下的就停
    async poll() {
      try {
        const chunk = await api(`/runs/${this.runId}/log?offset=${this.offset}`);
        if (chunk.text) {
          this.text += chunk.text;
          this.offset = chunk.offset;
          this.$nextTick(() => this.scrollDown());
        }
        if (chunk.running || chunk.text) {
          this.timer = setTimeout(() => this.poll(), chunk.running ? 1500 : 100);
        } else {
          await this.loadRun();
        }
      } catch {
        this.timer = setTimeout(() => this.poll(), 5000);
      }
    },
    scrollDown() {
      const el = this.$refs.log;
      if (el && this.autoScroll) el.scrollTop = el.scrollHeight;
    },
    async kill() {
      if (!confirm(`確定要關閉 run #${this.run.id} 嗎？`)) return;
      try {
        const res = await api(`/runs/${this.run.id}/kill`, { method: "POST" });
        notify(res.message, "success");
        await this.loadRun();
      } catch (err) {
        notify(err.message, "error");
      }
    },
    fmtTime,
    fmtDuration
  },
  template: `
    <main class="mx-auto max-w-6xl px-4 py-6">
      <p v-if="loading" class="py-20 text-center text-slate-400">載入中…</p>
      <div v-else-if="notFound" class="card p-10 text-center text-slate-500">
        找不到這個執行紀錄。<a href="/" class="text-blue-600 underline">回看板列表</a>
      </div>

      <template v-else-if="run">
        <a :href="boardLink" class="text-sm text-slate-500 hover:text-slate-800">← {{ run.board_title }}</a>
        <div class="card mt-2 p-5">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-xl font-bold text-slate-900">run #{{ run.id }}</h1>
            <RunBadge :status="run.status" />
            <span class="text-sm text-slate-600">{{ kindLabel }} · 🤖 {{ run.agent_name }}</span>
            <a v-if="ticketLink" :href="ticketLink" class="text-sm text-blue-600 hover:underline">票 #{{ run.ticket_id }}</a>
            <button v-if="run.live" class="btn btn-danger btn-sm ml-auto" @click="kill">關閉這個 agent</button>
          </div>
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>模型 <span class="mono">{{ run.model }}</span></span>
            <span>開始 {{ fmtTime(run.started_at) }}</span>
            <span v-if="run.ended_at">結束 {{ fmtTime(run.ended_at) }}</span>
            <span>耗時 {{ fmtDuration(run.started_at, run.ended_at) }}</span>
            <span v-if="run.exit_code !== null">exit code {{ run.exit_code }}</span>
            <span v-if="run.error" class="text-red-600">{{ run.error }}</span>
          </div>
          <div v-if="run.skills.length" class="mt-3 flex flex-wrap items-center gap-1.5">
            <span class="text-xs text-slate-500">skills：</span>
            <span v-for="s in run.skills" :key="s" class="mono rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{{ s }}</span>
          </div>
          <div v-if="run.prompt" class="mt-3 rounded-lg border border-slate-200">
            <button class="flex w-full items-center px-3 py-2 text-left text-xs font-semibold text-slate-600" @click="showPrompt = !showPrompt">
              PM 交代的 prompt <span class="ml-auto font-normal text-slate-400">{{ promptLabel }}</span>
            </button>
            <div v-if="showPrompt" class="border-t border-slate-200 p-3"><MdView :source="run.prompt" /></div>
          </div>
        </div>

        <div class="mt-4 flex items-center gap-3">
          <h2 class="text-sm font-semibold text-slate-700">Log</h2>
          <span v-if="run.live" class="inline-flex items-center gap-1 text-xs text-blue-600">
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500"></span>即時更新中
          </span>
          <label class="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
            <input v-model="autoScroll" type="checkbox" class="h-3.5 w-3.5"> 自動捲到最新
          </label>
        </div>
        <div ref="log" class="mono mt-2 h-[65vh] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-relaxed">
          <div v-for="(line, i) in lines" :key="i" class="min-h-[1.2em] whitespace-pre-wrap break-words" :class="line.cls">{{ line.text }}</div>
        </div>
      </template>
    </main>`
};

bootPage(RunPage, { active: "boards" });
