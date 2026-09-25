<template><view /></template>

<script setup>
import { onLoad } from '@dcloudio/uni-app';
import { getCurrentInstance } from 'vue';
import { navigate, installNavigationHooks } from './services/navigation.mjs';
installNavigationHooks(getCurrentInstance().proxy.$router);
onLoad((query) => navigate('explore', query, true));
</script>
