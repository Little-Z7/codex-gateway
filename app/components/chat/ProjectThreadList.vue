<script setup lang="ts">
import ChatComposer from "@/components/chat/ChatComposer.vue";
import NewThreadHero from "@/components/chat/NewThreadHero.vue";
</script>

<template>
  <section data-testid="project-thread-list" class="mx-auto flex w-full max-w-3xl flex-col">
    <NewThreadHero project-page>
      <ChatComposer />
    </NewThreadHero>
  </section>
</template>
