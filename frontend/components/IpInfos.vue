<template>
  <!-- IP Infos -->
  <section class="ip-data-section mb-10 mt-2">
    <header class="mb-2 flex flex-col items-start justify-between gap-4">
      <h2 id="IPInfo"
        class="m-0 flex min-w-0 flex-1 items-center gap-2 text-xl md:text-3xl font-semibold tracking-tight leading-tight">
        🔦 {{ t('ipInfos.Title') }}
      </h2>
      <div class="text-base text-muted-foreground">
        <p v-if="!isSimpleMode">{{ t('ipInfos.Notes') }}</p>
      </div>
    </header>

    <!-- Trust assessment leads the section: one verdict for the address, with
         the registry evidence under it, before the per-source cards repeat the
         same facts in more detail. -->
    <TrustScorePanel v-if="primaryIpCard" class="mb-4" :ip="primaryIpCard.ip" :geo="primaryIpCard" />

    <!-- Card grid: 1 col on mobile, always 2 cols on PC (md+). Card counts
        (2 / 4 / 6) are all even, so the last row always fills. -->
    <div class="grid gap-4 items-stretch grid-cols-1 md:grid-cols-2">
      <div v-for="(card, index) in ipDataCards.slice(0, ipCardsToShow)" :key="card.id" :ref="card.id"
        :id="'IPInfoCard-' + (index + 1)" class="flex"
        :class="{ 'opacity-60': !card.ip || card.ip === t('ipInfos.IPv4Error') || card.ip === t('ipInfos.IPv6Error') }">
        <IPCard class="w-full" :card="card" :index="index" :isDarkMode="isDarkMode" :isMobile="isMobile"
          :ipGeoSource="ipGeoSource" :configs="configs" :asnInfos="asnInfos" :asnHistoryInfos="asnHistoryInfos"
          :asnConnectivityInfos="asnConnectivityInfos" @refresh-card="refreshCard" />
      </div>
    </div>

    <!-- Section banner slot — renders nothing unless a data file for this
        section exists (see InfoBanner.vue). -->
    <InfoBanner section="ipinfo" :settled="cardsHaveSettled" />
  </section>
</template>


<script setup>
// The per-source card grid. It renders; it does not measure.
//
// Resolving the visitor's addresses and looking each one up lives in
// composables/use-ip-cards.js, because the homepage needs that work done without
// this grid being on screen: `/` shows one summary card and the routing table,
// `/ipinfo` shows these cards, and both read the same `ipinfo:finished` snapshot.
// Whichever route is mounted owns the `ipinfo:refresh` command, and only one of
// them is mounted at a time.

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMainStore } from '@/store';
import { useIpCards } from '@/composables/use-ip-cards.js';
import IPCard from './ip-infos/IPCard.vue';
import InfoBanner from './widgets/InfoBanner.vue';
import TrustScorePanel from './ip-infos/TrustScorePanel.vue';


const { t } = useI18n();
const store = useMainStore();
const isSimpleMode = computed(() => store.userPreferences.simpleMode);

const {
  ipDataCards,
  ipCardsToShow,
  primaryIpCard,
  cardsHaveSettled,
  ipGeoSource,
  asnInfos,
  asnHistoryInfos,
  asnConnectivityInfos,
  configs,
  isDarkMode,
  isMobile,
  refreshCard,
} = useIpCards();
</script>

<style scoped></style>
