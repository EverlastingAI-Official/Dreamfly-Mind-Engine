import { defineComponent, getCurrentInstance, h, ref } from 'vue';
import { onLoad, onShow, onHide } from '@dcloudio/uni-app';
import PlatformWorkspace from '../components/PlatformWorkspace.vue';

// These hooks belong to the registered page, not its nested business panels.
export function createRoutePage(pageName) {
  return defineComponent({
    setup() {
      const page = getCurrentInstance().proxy;
      const query = ref(null);
      const active = ref(false);
      // H5's router has already decoded URL values; onLoad options decode twice.
      onLoad(() => {
        query.value = { ...page.$route.query };
      });
      onShow(() => {
        active.value = true;
      });
      onHide(() => {
        active.value = false;
      });
      return () =>
        query.value &&
        h(PlatformWorkspace, {
          pageName,
          query: query.value,
          active: active.value,
        });
    },
  });
}
