import { InlineKeyboard } from 'grammy';
import { ControlPanelConfig } from '../../control-panel/core/types.js';
import { RailwayRelayItem } from '../../control-panel/core/railwayClient.js';

export class RelayKeyboards {
  static buildRelaySettingsMenu(config: ControlPanelConfig): InlineKeyboard {
    const kb = new InlineKeyboard();
    const tokenStatus = config.railwayApiKey ? '[Set]' : '[Not Set]';
    const gatewayDom = config.railwayDomain ? `[${config.railwayDomain.slice(0, 15)}...]` : '[None]';
    const llamaDom = config.llama.railwayEndpointUrl ? `[${config.llama.railwayEndpointUrl.slice(0, 15)}...]` : '[None]';

    kb.text('1. WebUI Ingress Domain', 'relay:webui').row();
    kb.text(`2. Gateway Relay (Discord/Egress) ${gatewayDom}`, 'relay:gateway').row();
    kb.text(`3. LLaMA AI Relay ${llamaDom}`, 'relay:llama').row();
    kb.text(`4. Railway API Token ${tokenStatus}`, 'relay:token').row();
    kb.text('< Back to Main Menu', 'menu:back');
    return kb;
  }

  static buildRelayPickerKeyboard(relays: RailwayRelayItem[], relayType: 'gateway' | 'llama'): InlineKeyboard {
    const kb = new InlineKeyboard();
    for (const r of relays.slice(0, 6)) {
      const target = r.domain || r.fullUrl;
      kb.text(`${r.serviceName} (${target})`, `relay:pick:${relayType}:${target}`).row();
    }
    kb.text('Enter Custom Domain / URL', `relay:custom:${relayType}`).row();
    kb.text('< Back to Relay Settings', 'menu:relay-settings');
    return kb;
  }
}
