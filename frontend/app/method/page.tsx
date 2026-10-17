"use client";

/**
 * 方法與限制：各頁的定義、算法與但書集中寫在這一頁，頁面上只留短標籤與連到這裡的「說明」。
 * 每一段有錨點（HelpLink 的 MethodSection）；數字讀同一份匯出（monitor.json、rank/summary.json、track-record.json），
 * 讀不到時只寫定義、不寫數字。
 */

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { MethodSection } from "@/components/ui/HelpLink";
import PageHeader from "@/components/ui/PageHeader";
import { api } from "@/lib/api";
import { fixed, share } from "@/lib/format";
import { BIAS_PERIODS, LOOKBACK, MA_PERIODS, VOLUME_SURGE, WARMUP } from "@/lib/indicators";
import { LINKS } from "@/lib/links";
import { MODEL_STATUS } from "@/lib/status";
import { useAsync } from "@/lib/useAsync";

function Section({ id, title, children }: { id: MethodSection; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 border-t border-border py-6 first:border-t-0 first:pt-0">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink-2 [&_strong]:font-semibold [&_strong]:text-ink">{children}</div>
    </section>
  );
}

function Doc({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
      {children}
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

const TOC: { id: MethodSection; label: string }[] = [
  { id: "reading", label: "三個數字各回答什麼" },
  { id: "rank", label: "相對強弱排序" },
  { id: "model", label: "模型效果怎麼看" },
  { id: "backtest", label: "回測與示意組合" },
  { id: "direction", label: "方向訊號" },
  { id: "screener", label: "篩選器" },
  { id: "chips", label: "融資融券與大戶" },
  { id: "ledger", label: "預測存證" },
  { id: "market", label: "大盤多空標籤" },
  { id: "chart", label: "K 線圖的均線與指標" },
  { id: "data", label: "資料與授權" },
];

export default function MethodPage() {
  const monitor = useAsync("monitor", () => api.monitor());
  const summary = useAsync("rank-summary", () => api.rankSummary());
  const record = useAsync("track-record", () => api.trackRecord());
  const m = monitor.data?.model;
  const live = m?.groups?.live;
  const s = summary.data?.available ? summary.data : null;
  const all = record.data?.samples?.find((x) => x.key === "all");

  return (
    <>
      <PageHeader title="方法與限制" description="網站上每個數字怎麼算、驗證到哪裡、還有什麼沒驗證。各頁的「說明」連結都連到這一頁的對應段落。" />

      <nav aria-label="本頁段落" className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {TOC.map((t) => (
          <a key={t.id} href={`#${t.id}`} className="text-accent hover:underline">
            {t.label}
          </a>
        ))}
      </nav>

      <div className="max-w-[72ch]">
        <Section id="reading" title="三個數字各回答什麼">
          <p>
            <strong>相對強弱名次</strong>：這一檔和其他 48 檔比，未來 5 個交易日誰比較強。只是相對位置，名次靠前仍可能下跌。
          </p>
          <p>
            <strong>方向訊號</strong>：這一檔自己未來 5 個交易日的累積報酬會不會超過 ±2%（漲、跌、觀望）。和名次是不同的模型、不同的問題，兩者可能不一致。
          </p>
          <p>
            <strong>篩選器</strong>：把名次、動能、評價、營收、籌碼依事先公開的固定規則整理成候選清單，不是預測。
          </p>
          <p>三者都是研究用的統計輸出，不構成投資建議。</p>
        </Section>

        <Section id="rank" title="相對強弱排序">
          <p>
            模型（XGBoost 橫斷面模型）依收盤為止的資料，估計每一檔未來 5 個交易日贏過全池中位數的機率，這就是表上的<strong>模型分數</strong>。
            分數是模型輸出，沒有做過機率校準。<strong>百分位</strong>是這個分數在股票池裡的名次位置，兩者不是同一個數字。
          </p>
          <p>
            <strong>分組</strong>依名次分成前 20%、中段、後 20%：只描述相對位置，不代表會漲或跌。篩選器的 C1 條件用的是另一個門檻（前 40%）。
          </p>
          <p>
            有紀錄的基準日，表上就是資料庫裡記錄、並串入存證鏈的那一份排序；沒有紀錄的日子才依當時可得的資料重新評分，並在頁面上標示。
          </p>
          <p>
            <strong>股票池</strong>是台灣 50 指數的成分股，每季定期審核後依官方名單更新。2026-10-19 起換成 2026 年 9 月審核後的名單（移出 13 檔、納入 14 檔），
            模型不變；之前的預測、成績與存證是當時的 49 檔，不回頭重算。
          </p>
        </Section>

        <Section id="model" title="模型效果怎麼看">
          <p>
            <strong>Rank IC</strong> 是預測排序與實際 5 日報酬排序的相關係數，0 代表沒有預測力。相鄰基準日的 5 日報酬互相重疊，逐日 IC 會自我相關，所以 t 值用
            Newey–West 標準誤（落後 4 期）。
          </p>
          <p>
            <strong>技能檢定</strong>：線上平均 Rank IC 對 0 的 t 值，門檻 2（文獻對新因子另用 3）。
            {live && live.t_nw != null && `目前即時記錄 ${live.n_days} 天的 t 為 ${fixed(live.t_nw, 2)}。`}
          </p>
          <p>
            線上成績分三組：<strong>即時記錄</strong>（每日排程在預測窗口開始、也就是下一個交易日開盤前寫入，主要的前瞻成績）、
            <strong>事後重建或補寫</strong>（窗口開始後才寫入：資料延遲時依當時可得的資料重算，或排程晚跑補記；其中幾天在模型訓練完成之前）、
            <strong>到期前已公開存證</strong>（預測窗口開始前就串入存證鏈，2026-10-07 起才有）。窗口開始的時間依實際交易日計算，連假不算。
          </p>
          <p>
            <strong>狀態</strong>依預先聲明的規則，用全部到期日（含事後重建或補寫）判定：
            {(["normal", "watch", "breakdown", "insufficient"] as const).map((k, i) => (
              <span key={k}>
                {i > 0 && "；"}「{MODEL_STATUS[k].text}」＝{MODEL_STATUS[k].note}
              </span>
            ))}
            。狀態只顯示，不會自動停用模型。
          </p>
          <p>
            <Doc href={LINKS.monitorRules}>監控規則的預先聲明</Doc>
          </p>
        </Section>

        <Section id="backtest" title="回測與示意組合">
          <p>
            模型只用 2024 年底以前的資料訓練；2025 年是驗證期，用來選模型與持有期；2026 上半年是測試期，只做最後一次驗證。
            {s && s.test_rank_ic != null && `測試期 Rank IC ${fixed(s.test_rank_ic, 3, true)}${s.test_rank_ic_t_nw != null ? `（Newey–West t ${fixed(s.test_rank_ic_t_nw, 2)}）` : ""}，未達雙尾 5% 顯著。`}
          </p>
          <p>
            示意組合：每 {s?.holding_days ?? 20} 個交易日買進名次前 20% 的股票。<strong>扣成本後比全池等權多幾個百分點</strong>
            是兩個累積報酬相減（{s && s.net_cum != null && s.bench_cum != null ? `${share(s.net_cum, 1)} − ${share(s.bench_cum, 1)}` : "組合 − 全池"}），不是比率。
            這段期間包含用來選模型與持有期的 2025 年，<strong>不是獨立驗證</strong>；成本約 {s?.cost_bps?.toFixed(0) ?? 59} bp 來回，<strong>沒有計入滑價</strong>，全池等權的基準也沒有扣成本。
            最大回撤、滑價敏感度與簡單動能策略的比較還沒有做。
          </p>
          <p>
            <Doc href={LINKS.rankReport}>完整回測報告</Doc>
          </p>
        </Section>

        <Section id="direction" title="方向訊號">
          <p>
            <strong>漲</strong>＝未來 5 個交易日累積報酬大於 +2%，<strong>跌</strong>＝小於 −2%，其餘是觀望。卡片上的百分比是模型輸出的類別機率，
            <strong>沒有做過機率校準</strong>，不等於實際發生的機率。漲或跌的機率最高但沒有達到決策門檻（在驗證期選定）時，依規則改為觀望，標「規則降級」。
          </p>
          <p>
            命中率一定要和同一批樣本的<strong>基線</strong>比：全猜觀望、全猜漲的命中率。
            {all && all.hit_rate != null && all.baseline_hold != null && all.baseline_up != null
              ? `目前到期 ${all.matured.toLocaleString()} 筆，命中 ${share(all.hit_rate, 1)}；全猜觀望 ${share(all.baseline_hold, 1)}、全猜漲 ${share(all.baseline_up, 1)}。`
              : ""}
            95% 區間以基準日為單位、區塊長度 5 的 block bootstrap 計算（同一天的股票彼此相關，相鄰基準日的報酬重疊）；區間跨過 0 代表還不能說贏過基線。
          </p>
          <p>
            每筆預測在推論當下寫入資料庫。部分基準日的預測在下一個交易日開盤後才寫入（隔天補記，或 2026-08-13 模型訓練完成後回補的 8/06–8/12），監控頁另外列出它們的成績。
          </p>
          <p>
            <Doc href={LINKS.onlineReport}>線上實證報告</Doc>
          </p>
        </Section>

        <Section id="screener" title="篩選器">
          <p>
            綜合評分由排序、動能、評價、營收、籌碼五個組成依公開的權重加權；T1、T2、T3 是適用的條件全部符合、少一項、少兩項，各層有上限、不足不補位。
            規則事先公開，改動會升版並寫明原因。
          </p>
          <p>
            月營收表只列出已申報的公司：每家公司各用自己最新已公布的月份，還沒申報新月份的沿用前一個月並在篩選頁列出；兩個月都沒有資料時算資料品質問題，依規則算不符合。
            金融保險業的營收不計，C4 條件不適用。
          </p>
          <p>
            <Doc href={LINKS.screenerRules}>篩選器規則的預先聲明</Doc>
          </p>
        </Section>

        <Section id="chips" title="融資融券與大戶持股">
          {/* 中文段落裡換行會變成空格：只在標籤旁換行 */}
          <p>
            個股頁的「融資融券與大戶持股」只用開放資料：證交所的融資融券餘額與個股日成交資訊，每個交易日收盤後一份；集保結算所的集保戶股權分散表，每週一份，是該週最後一個營業日營業結束後各集保帳戶的餘額，依身分證號歸戶。開放資料只提供最新一期，本站從開始累積的那天起才有資料，之前與漏收的日子補不回來。融資融券的單位是張（1 張＝1,000 股）。
          </p>
          <p>
            <strong>融資增減</strong>、<strong>融券增減</strong>＝今日餘額 − 前日餘額。
            <strong>融資使用率</strong>＝融資今日餘額 ÷ 融資限額，限額為 0 時不計。
            <strong>券資比</strong>＝融券今日餘額 ÷ 融資今日餘額，融資餘額為 0 時不計。
            <strong>資券互抵</strong>是同一天融資買進又融券賣出同一檔股票、互相抵銷的張數。
            <strong>成交張數</strong>＝成交股數 ÷ 1,000，四捨五入。
          </p>
          <p>
            <strong>千張大戶持股</strong>是持股分級 15（1,000,001 股以上）占集保庫存數的比例，照集保公布的數字；
            <strong>400 張以上</strong>是分級 12–15（400,001 股以上）四級相加。集保公布的比例只到小數 2 位，四級相加可能和用股數計算的結果差幾個 0.01 百分點。人數是歸戶後的持有人數，包含公司、基金、外資等法人，不只是個人。增減是和前一份週資料相比。
          </p>
          <p>
            <strong>融資成本（本站估算）</strong>：從第一個同時有融資餘額與收盤價的交易日起算，起算值是當天收盤價；之後每天的成本＝〔前一天的成本 ×（今日餘額 − 今日融資買進）＋ 今日收盤價 × 今日融資買進〕÷ 今日餘額，今日買進多於今日餘額時，餘額全部以收盤價計。融資餘額歸零，或有新的融資買進卻沒有收盤價時，成本不計，下一個有資料的交易日以收盤價重新起算；面板上寫著目前這段估算的起算日。
          </p>
          <p>
            這是全體融資部位的粗略平均，不是任何一位投資人的實際成本：起算前就存在的部位一律當作起算日以收盤價買進；新買進以收盤價計，不是實際成交價；賣出與償還假設依平均成本等比例減少；價格未還原權值，除權息不調整。
          </p>
          <p>
            <strong>融資維持率（本站估算）</strong>＝收盤價 ÷（融資成本 × 0.6）。0.6 是上市股票一般的融資成數（借款約為買進價款的 6 成），個別股票的成數可能被調降。實際的追繳以每位投資人整戶的擔保維持率計算，融資、融券合併，低於 130% 時券商通知補繳，所以單一個股的維持率估算不能用來判斷是否會被追繳。
          </p>
          <p>
            <strong>沒有外資、投信、自營商與主力的買賣超或成本</strong>：證交所沒有把個股的三大法人買賣超（T86 等報表）釋出為開放資料，這些資料在證交所的 Data E-Shop 販售；券商分點的買賣日報表在證交所網站查詢要輸入驗證碼，證交所網站的使用條款也不允許以程式下載與再散布。本站只用可以公開再散布的資料，所以不顯示這些數字。
          </p>
          <p>
            <strong>沒有當沖比</strong>：證交所的當日沖銷開放資料只列出可以當沖的股票與暫停註記，沒有個股的當沖成交量；融資融券表的資券互抵只涵蓋信用交易的部分，開放資料也沒有欄位定義說明。
          </p>
          <p>
            <Doc href={LINKS.dataSources}>資料來源與授權</Doc>
          </p>
        </Section>

        <Section id="ledger" title="預測存證">
          <p>
            每天新寫入的預測列，在排程保存資料庫之後串成雜湊鏈的一節，放在只新增、不覆寫的 ledger 分支；GitHub 的 commit 時間就是公開的時間戳。
            之後任何一列被修改、刪除或插入，驗證都會失敗。網站上的存證狀態是上鏈之後才匯出的快照，「第 N 節」從 1 起算，等於 chain.jsonl 的第 N 行。
          </p>
          <p>
            <strong>第 1 節</strong>（2026-10-07）一次涵蓋上鏈前就已存在的資料列：只能證明它們自那天起沒有被修改，<strong>不能證明更早</strong>。
          </p>
          <p>
            自己驗證：下載 ledger.py、predictions.db 與 chain.jsonl 後執行 <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm text-ink">python ledger.py verify --db predictions.db --chain chain.jsonl</code>
          </p>
          <p>
            <Doc href={LINKS.ledger}>下載方式與驗證說明</Doc>
          </p>
        </Section>

        <Section id="market" title="大盤多空標籤">
          <p>
            總覽「大盤」面板的標籤只看三個數字：5 日報酬大於 0、20 日均線乖離大於 0、上漲家數比高於 50%，三項都成立才標
            <strong>偏多</strong>；三項都反過來（小於 0、小於 0、低於 50%）才標
            <strong>偏空</strong>，其餘是<strong>中性</strong>。剛好等於 0 或 50% 不算任何一邊；任一項缺值時不標。
          </p>
          <p>
            <strong>5 日報酬</strong>是加權指數收盤價相對 5 個交易日前的漲跌幅；
            <strong>20 日均線乖離</strong>是加權指數收盤價 ÷ 最近 20 個交易日（含當天）的平均收盤價 − 1；
            <strong>上漲家數比</strong>是本站股票池裡，當天收盤價比前一個交易日高的檔數 ÷ 當天有價格的檔數（平盤不算上漲）。
          </p>
          <p>
            三個數字和模型的大盤特徵是同一份計算，每日排程收盤後匯出。價格來自模型訓練與推論用的 Yahoo Finance 資料（個股為還原權值，缺漏的交易日才以證交所盤後資料補上），和 K 線圖的來源不同，所以可能和證交所公布的數字略有出入。
          </p>
          <p>
            股票池是台灣 50 指數的成分股，所以上漲家數比只代表這 50 檔大型股，不是全市場的漲跌家數。
          </p>
          <p>標籤描述的是最近已經發生的狀態，不是預測，也不是買賣建議。</p>
        </Section>

        <Section id="chart" title="K 線圖的均線與指標">
          <p>
            <strong>均線</strong>是收盤價的簡單平均，週期 {MA_PERIODS.join("、")} 日。<strong>乖離率</strong>＝（收盤 − N 日均線）÷ N 日均線 × 100%，N＝
            {BIAS_PERIODS.join("、")}。副圖的算法與台灣常用的 XQ 內建指標相同：
          </p>
          <p>
            <strong>KD（9,3,3）</strong>：RSV＝100 ×（收盤 − 9 日最低）÷（9 日最高 − 9 日最低），最高等於最低時記為 50。
            K＝（2 × 前一日 K＋RSV）÷ 3，D＝（2 × 前一日 D＋K）÷ 3，第一天的 K、D 都從 50 起算。
          </p>
          <p>
            <strong>RSI（6,12）</strong>：第一個值用 N 日漲幅與跌幅的簡單平均，之後每天的平均＝前一日平均＋（當日漲跌幅 − 前一日平均）÷ N。
            RSI＝100 × 平均漲幅 ÷（平均漲幅＋平均跌幅），漲跌都是 0 時記為 0。
          </p>
          <p>
            <strong>MACD（12,26,9）</strong>：價格用（最高＋最低＋2 × 收盤）÷ 4；DIF＝12 日 EMA − 26 日 EMA，MACD＝DIF 的 9 日 EMA，OSC＝DIF − MACD。
            EMA 的平滑係數是 2 ÷（N＋1），從第一個值起算。
          </p>
          <p>
            指標用已累積的全部 K 線計算，再切到所選的區間，所以短區間的第一根也有長週期的值。
            起算值要經過一段時間才不影響結果，累積到足夠的交易日才畫：均線與乖離率要 N 個，KD 要 {WARMUP.kd} 個，RSI6 要 {WARMUP.rsi6} 個，RSI12 要 {WARMUP.rsi12} 個，MACD 要 {WARMUP.macd} 個。
            因為 K 線未還原權值，除權息日的價格缺口會讓均線、乖離率與指標失真。
          </p>
          <p>
            <strong>前高／前低</strong>是畫面最後一根之前 {LOOKBACK} 個交易日的最高價與最低價。<strong>放量突破／跌破</strong>：當日成交量至少是前 {LOOKBACK} 日平均量的{" "}
            {VOLUME_SURGE} 倍，且收盤高於前 {LOOKBACK} 日最高價（突破）或低於前 {LOOKBACK} 日最低價（跌破）。
          </p>
          <p>這些都是價量計算，不是模型訊號，也不是買賣建議。</p>
          <p>
            個股頁的「模型輸入的技術指標」是另一組數字：用 Yahoo 還原權值的歷史價格計算，是預測模型的輸入特徵，參數與算法依模型的特徵管線（例如 RSI 取
            14 日、MACD 柱除以收盤價），和 K 線副圖的值不會一樣。
          </p>
        </Section>

        <Section id="data" title="資料與授權">
          <p>
            K 線、評價、月營收、融資融券來自臺灣證券交易所，股權分散來自臺灣集中保管結算所的開放資料，依政府資料開放授權條款第 1 版利用。
            開放資料只提供最新一個交易日，本站自 2026-10-02 起逐日累積，K 線未還原權值。模型訓練用的歷史價格只在內部研究使用，不對外提供。
          </p>
          <p>個股頁的新聞情緒來自另一個網站（英文財經新聞），只供跨市場參考，不是預測模型的輸入。</p>
          <p>
            <Doc href={LINKS.dataSources}>資料來源與授權</Doc>
          </p>
        </Section>
      </div>
    </>
  );
}
