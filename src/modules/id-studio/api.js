import {api} from '../../lib/api.js';

const call=(action,payload={})=>api.admin({action,...payload});

export const idStudioApi={
  dashboard:()=>call('id_studio_dashboard'),
  listCards:(filters={})=>call('id_studio_cards_list',{filters}),
  getCard:(id)=>call('id_studio_card_get',{id}),
  getCardHistory:(id)=>call('id_studio_card_history',{id}),
  createCard:(card)=>call('id_studio_card_create',{card}),
  cloneCard:(id,override={})=>call('id_studio_card_clone',{id,override}),
  bulkImport:(rows=[])=>call('id_studio_bulk_import',{rows}),
  updateCard:(id,patch)=>call('id_studio_card_update',{id,patch}),
  uploadPhoto:(id,dataUrl)=>call('id_studio_photo_upload',{id,data_url:dataUrl}),
  submitForApproval:(id)=>call('id_studio_card_submit',{id}),
  approveCard:(id)=>call('id_studio_card_approve',{id}),
  suspendCard:(id,reason)=>call('id_studio_card_suspend',{id,reason}),
  resumeCard:(id,reason)=>call('id_studio_card_resume',{id,reason}),
  markLost:(id,reason)=>call('id_studio_card_lost',{id,reason}),
  revokeCard:(id,reason)=>call('id_studio_card_revoke',{id,reason}),
  reissueCard:(id,reason)=>call('id_studio_card_reissue',{id,reason}),
  logPrint:(id,printSide,copies=1,printerProfileId=null)=>call('id_studio_print_log',{id,print_side:printSide,copies,printer_profile_id:printerProfileId}),
  listTemplates:()=>call('id_studio_templates_list'),
  saveTemplate:(code,config,defaultOrientation)=>call('id_studio_template_save',{code,config,default_orientation:defaultOrientation}),
  restoreTemplate:(code)=>call('id_studio_template_restore',{code}),
  listPrinterProfiles:()=>call('id_studio_printer_profiles_list'),
  savePrinterProfile:(profile)=>call('id_studio_printer_profile_save',{profile}),
  audit:(filters={})=>call('id_studio_audit_list',{filters}),
};
