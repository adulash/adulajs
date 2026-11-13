/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'home': {
    methods: ["GET","HEAD"]
    pattern: '/'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/home_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/home_controller').default['show']>>>
    }
  }
  'event_stream': {
    methods: ["GET","HEAD"]
    pattern: '/__transmit/events'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'subscribe': {
    methods: ["POST"]
    pattern: '/__transmit/subscribe'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'unsubscribe': {
    methods: ["POST"]
    pattern: '/__transmit/unsubscribe'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'mcp.post': {
    methods: ["POST"]
    pattern: '/mcp'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'assistant.accept_notice': {
    methods: ["POST"]
    pattern: '/assistant/notice'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assistant_controller').default['acceptNotice']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assistant_controller').default['acceptNotice']>>>
    }
  }
  'assistant.start_conversation': {
    methods: ["POST"]
    pattern: '/assistant/conversations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assistant_controller').default['startConversation']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assistant_controller').default['startConversation']>>>
    }
  }
  'assistant.turn': {
    methods: ["POST"]
    pattern: '/assistant/conversations/:conversation/turns'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { conversation: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assistant_controller').default['turn']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assistant_controller').default['turn']>>>
    }
  }
  'assistant.confirm': {
    methods: ["POST"]
    pattern: '/assistant/conversations/:conversation/actions/:id/confirm'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { conversation: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assistant_controller').default['confirm']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assistant_controller').default['confirm']>>>
    }
  }
  'assistant.reject': {
    methods: ["POST"]
    pattern: '/assistant/conversations/:conversation/actions/:id/reject'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { conversation: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assistant_controller').default['reject']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assistant_controller').default['reject']>>>
    }
  }
  'inbound_webhooks.receive': {
    methods: ["POST"]
    pattern: '/webhooks/in/:source'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { source: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/inbound_webhooks_controller').default['receive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/inbound_webhooks_controller').default['receive']>>>
    }
  }
  'resources.index': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['index']>>>
    }
  }
  'resources.create': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/create'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['create']>>>
    }
  }
  'record_views.create': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/create/view'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_views_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_views_controller').default['create']>>>
    }
  }
  'resources.options': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/options/:field'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; field: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['options']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['options']>>>
    }
  }
  'resources.aggregate': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/aggregate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['aggregate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['aggregate']>>>
    }
  }
  'resources.export': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/export'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['export']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['export']>>>
    }
  }
  'resources.trash': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/trash'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['trash']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['trash']>>>
    }
  }
  'resources.bulk_actions': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/bulk'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['bulkActions']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['bulkActions']>>>
    }
  }
  'resources.bulk': {
    methods: ["POST"]
    pattern: '/resources/:resource/bulk'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['bulk']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['bulk']>>>
    }
  }
  'resources.restore': {
    methods: ["POST"]
    pattern: '/resources/:resource/:id/restore'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['restore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['restore']>>>
    }
  }
  'dashboards.index': {
    methods: ["GET","HEAD"]
    pattern: '/dashboards'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dashboards_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dashboards_controller').default['index']>>>
    }
  }
  'dashboards.show': {
    methods: ["GET","HEAD"]
    pattern: '/dashboards/:name'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { name: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dashboards_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dashboards_controller').default['show']>>>
    }
  }
  'imports.store': {
    methods: ["POST"]
    pattern: '/resources/:resource/imports'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>>
    }
  }
  'imports.template': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/imports/template'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['template']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['template']>>>
    }
  }
  'imports.index': {
    methods: ["GET","HEAD"]
    pattern: '/imports'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['index']>>>
    }
  }
  'imports.show': {
    methods: ["GET","HEAD"]
    pattern: '/imports/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['show']>>>
    }
  }
  'imports.start': {
    methods: ["POST"]
    pattern: '/imports/:id/start'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['start']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['start']>>>
    }
  }
  'record_collaboration.tag_options': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/tag-options'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['tagOptions']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['tagOptions']>>>
    }
  }
  'record_collaboration.show': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/:id/collaboration'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['show']>>>
    }
  }
  'record_collaboration.mentions': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/:id/mentions'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['mentions']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['mentions']>>>
    }
  }
  'record_collaboration.comment': {
    methods: ["POST"]
    pattern: '/resources/:resource/:id/comments'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['comment']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['comment']>>>
    }
  }
  'record_collaboration.edit_comment': {
    methods: ["PATCH"]
    pattern: '/resources/:resource/:id/comments/:comment'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue; comment: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['editComment']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['editComment']>>>
    }
  }
  'record_collaboration.delete_comment': {
    methods: ["DELETE"]
    pattern: '/resources/:resource/:id/comments/:comment'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue; comment: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['deleteComment']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['deleteComment']>>>
    }
  }
  'record_collaboration.follow': {
    methods: ["PUT"]
    pattern: '/resources/:resource/:id/follow'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['follow']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['follow']>>>
    }
  }
  'record_collaboration.tags': {
    methods: ["PUT"]
    pattern: '/resources/:resource/:id/tags'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['tags']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_collaboration_controller').default['tags']>>>
    }
  }
  'print.templates': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/print-templates'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/print_controller').default['templates']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/print_controller').default['templates']>>>
    }
  }
  'print': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/:id/print'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/print_controller').default['handle']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/print_controller').default['handle']>>>
    }
  }
  'assignments.for_record': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/:id/assignments'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assignments_controller').default['forRecord']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assignments_controller').default['forRecord']>>>
    }
  }
  'assignments.store': {
    methods: ["POST"]
    pattern: '/resources/:resource/:id/assignments'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assignments_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assignments_controller').default['store']>>>
    }
  }
  'workflows.for_record': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/:id/workflows'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/workflows_controller').default['forRecord']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/workflows_controller').default['forRecord']>>>
    }
  }
  'workflows.inbox': {
    methods: ["GET","HEAD"]
    pattern: '/approvals'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/workflows_controller').default['inbox']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/workflows_controller').default['inbox']>>>
    }
  }
  'workflows.decide': {
    methods: ["POST"]
    pattern: '/workflows/:run/decide'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { run: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/workflows_controller').default['decide']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/workflows_controller').default['decide']>>>
    }
  }
  'assignments.mine': {
    methods: ["GET","HEAD"]
    pattern: '/my-tasks'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assignments_controller').default['mine']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assignments_controller').default['mine']>>>
    }
  }
  'assignments.complete': {
    methods: ["POST"]
    pattern: '/my-tasks/:assignment/complete'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { assignment: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assignments_controller').default['complete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assignments_controller').default['complete']>>>
    }
  }
  'assignments.cancel': {
    methods: ["POST"]
    pattern: '/my-tasks/:assignment/cancel'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { assignment: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assignments_controller').default['cancel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assignments_controller').default['cancel']>>>
    }
  }
  'record_views.show': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/:id/view'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_views_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_views_controller').default['show']>>>
    }
  }
  'record_views.row': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/:id/row'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/record_views_controller').default['row']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/record_views_controller').default['row']>>>
    }
  }
  'resources.edit': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['edit']>>>
    }
  }
  'resources.show': {
    methods: ["GET","HEAD"]
    pattern: '/resources/:resource/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['show']>>>
    }
  }
  'resources.store': {
    methods: ["POST"]
    pattern: '/resources/:resource'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['store']>>>
    }
  }
  'resources.update': {
    methods: ["PATCH"]
    pattern: '/resources/:resource/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['update']>>>
    }
  }
  'resources.destroy': {
    methods: ["DELETE"]
    pattern: '/resources/:resource/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['destroy']>>>
    }
  }
  'resources.submit': {
    methods: ["POST"]
    pattern: '/resources/:resource/:id/submit'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['submit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['submit']>>>
    }
  }
  'resources.cancel': {
    methods: ["POST"]
    pattern: '/resources/:resource/:id/cancel'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['cancel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['cancel']>>>
    }
  }
  'resources.amend': {
    methods: ["POST"]
    pattern: '/resources/:resource/:id/amend'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['amend']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['amend']>>>
    }
  }
  'saved_views.store': {
    methods: ["POST"]
    pattern: '/resources/:resource/views'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/saved_views_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/saved_views_controller').default['store']>>>
    }
  }
  'saved_views.destroy': {
    methods: ["DELETE"]
    pattern: '/resources/:resource/views/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/saved_views_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/saved_views_controller').default['destroy']>>>
    }
  }
  'attachments.store': {
    methods: ["POST"]
    pattern: '/attachments'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/attachments_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/attachments_controller').default['store']>>>
    }
  }
  'attachments.show': {
    methods: ["GET","HEAD"]
    pattern: '/attachments/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/attachments_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/attachments_controller').default['show']>>>
    }
  }
  'api.open_api': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/openapi.json'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/openapi_controller').default['handle']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/openapi_controller').default['handle']>>>
    }
  }
  'api.open_api.client': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/client.ts'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/openapi_controller').default['client']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/openapi_controller').default['client']>>>
    }
  }
  'api.open_api.declarations': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/client.d.ts'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/openapi_controller').default['declarations']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/openapi_controller').default['declarations']>>>
    }
  }
  'api.resources.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/resources/:resource'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['index']>>>
    }
  }
  'api.resources.aggregate': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/resources/:resource/aggregate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['aggregate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['aggregate']>>>
    }
  }
  'api.imports.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/imports'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['index']>>>
    }
  }
  'api.imports.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/imports/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['show']>>>
    }
  }
  'api.imports.start': {
    methods: ["POST"]
    pattern: '/api/v1/imports/:id/start'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['start']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['start']>>>
    }
  }
  'api.imports.store': {
    methods: ["POST"]
    pattern: '/api/v1/resources/:resource/imports'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['store']>>>
    }
  }
  'api.imports.template': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/resources/:resource/imports/template'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['template']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/imports_controller').default['template']>>>
    }
  }
  'api.resources.export': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/resources/:resource/export'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['export']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['export']>>>
    }
  }
  'api.resources.trash': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/resources/:resource/trash'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['trash']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['trash']>>>
    }
  }
  'api.resources.bulk_actions': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/resources/:resource/bulk'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['bulkActions']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['bulkActions']>>>
    }
  }
  'api.resources.bulk': {
    methods: ["POST"]
    pattern: '/api/v1/resources/:resource/bulk'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['bulk']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['bulk']>>>
    }
  }
  'api.resources.restore': {
    methods: ["POST"]
    pattern: '/api/v1/resources/:resource/:id/restore'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['restore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['restore']>>>
    }
  }
  'api.resources.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/resources/:resource/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['show']>>>
    }
  }
  'api.resources.store': {
    methods: ["POST"]
    pattern: '/api/v1/resources/:resource'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { resource: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['store']>>>
    }
  }
  'api.resources.update': {
    methods: ["PATCH"]
    pattern: '/api/v1/resources/:resource/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['update']>>>
    }
  }
  'api.resources.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/resources/:resource/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['destroy']>>>
    }
  }
  'api.resources.submit': {
    methods: ["POST"]
    pattern: '/api/v1/resources/:resource/:id/submit'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['submit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['submit']>>>
    }
  }
  'api.resources.cancel': {
    methods: ["POST"]
    pattern: '/api/v1/resources/:resource/:id/cancel'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['cancel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['cancel']>>>
    }
  }
  'api.resources.amend': {
    methods: ["POST"]
    pattern: '/api/v1/resources/:resource/:id/amend'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['amend']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/resources_controller').default['amend']>>>
    }
  }
  'appearance_logos.show': {
    methods: ["GET","HEAD"]
    pattern: '/appearance/logos/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/appearance_logos_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/appearance_logos_controller').default['show']>>>
    }
  }
  'new_account.create': {
    methods: ["GET","HEAD"]
    pattern: '/signup'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['create']>>>
    }
  }
  'user_invitations.show': {
    methods: ["GET","HEAD"]
    pattern: '/invitations/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_invitations_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_invitations_controller').default['show']>>>
    }
  }
  'user_invitations.accept': {
    methods: ["POST"]
    pattern: '/invitations/:token'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').acceptInvitationValidator)>>
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/user').acceptInvitationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_invitations_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_invitations_controller').default['accept']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'new_account.store': {
    methods: ["POST"]
    pattern: '/signup'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').signupValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').signupValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'session.create': {
    methods: ["GET","HEAD"]
    pattern: '/login'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
    }
  }
  'session.store': {
    methods: ["POST"]
    pattern: '/login'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').loginValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').loginValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'two_factor.challenge': {
    methods: ["GET","HEAD"]
    pattern: '/login/two-factor'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/two_factor_challenge_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/two_factor_challenge_controller').default['create']>>>
    }
  }
  'two_factor.verify': {
    methods: ["POST"]
    pattern: '/login/two-factor'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/two_factor_challenge_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/two_factor_challenge_controller').default['store']>>>
    }
  }
  'password_reset.forgot': {
    methods: ["GET","HEAD"]
    pattern: '/password/forgot'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['forgot']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['forgot']>>>
    }
  }
  'password_reset.send': {
    methods: ["POST"]
    pattern: '/password/forgot'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').forgotPasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').forgotPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['send']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['send']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'password_reset.reset': {
    methods: ["GET","HEAD"]
    pattern: '/password/reset/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['reset']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['reset']>>>
    }
  }
  'password_reset.update': {
    methods: ["POST"]
    pattern: '/password/reset/:token'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').resetPasswordValidator)>>
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/user').resetPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'oauth.redirect': {
    methods: ["GET","HEAD"]
    pattern: '/oauth/:provider/redirect'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { provider: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/oauth_controller').default['redirect']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/oauth_controller').default['redirect']>>>
    }
  }
  'oauth.callback': {
    methods: ["GET","HEAD"]
    pattern: '/oauth/:provider/callback'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { provider: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/oauth_controller').default['callback']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/oauth_controller').default['callback']>>>
    }
  }
  'session.destroy': {
    methods: ["POST"]
    pattern: '/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
    }
  }
  'user_invitations.create': {
    methods: ["GET","HEAD"]
    pattern: '/users/invite'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_invitations_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_invitations_controller').default['create']>>>
    }
  }
  'user_invitations.store': {
    methods: ["POST"]
    pattern: '/users/invite'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').invitationValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').invitationValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/user_invitations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/user_invitations_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'avatars.show': {
    methods: ["GET","HEAD"]
    pattern: '/users/:id/avatar'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/avatars_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/avatars_controller').default['show']>>>
    }
  }
  'avatars.store_own': {
    methods: ["POST"]
    pattern: '/account/avatar'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/avatars_controller').default['storeOwn']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/avatars_controller').default['storeOwn']>>>
    }
  }
  'avatars.destroy_own': {
    methods: ["DELETE"]
    pattern: '/account/avatar'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/avatars_controller').default['destroyOwn']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/avatars_controller').default['destroyOwn']>>>
    }
  }
  'profile.show': {
    methods: ["GET","HEAD"]
    pattern: '/account/profile'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
    }
  }
  'profile.update': {
    methods: ["PATCH"]
    pattern: '/account/profile'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').profileValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').profileValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'profile.password': {
    methods: ["POST"]
    pattern: '/account/password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').changePasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').changePasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['password']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['password']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'language.update': {
    methods: ["PUT"]
    pattern: '/account/language'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/language_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/language_controller').default['update']>>>
    }
  }
  'preferences.update': {
    methods: ["PUT"]
    pattern: '/account/preferences/:key'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/preferences_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/preferences_controller').default['update']>>>
    }
  }
  'preferences.destroy': {
    methods: ["DELETE"]
    pattern: '/account/preferences/:key'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/preferences_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/preferences_controller').default['destroy']>>>
    }
  }
  'profile.channels': {
    methods: ["PUT"]
    pattern: '/account/notification-channels'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['channels']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['channels']>>>
    }
  }
  'profile.channel_code': {
    methods: ["POST"]
    pattern: '/account/notification-channels/:key/code'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['channelCode']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['channelCode']>>>
    }
  }
  'profile.channel_confirm': {
    methods: ["POST"]
    pattern: '/account/notification-channels/:key/confirm'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['channelConfirm']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['channelConfirm']>>>
    }
  }
  'two_factor.begin': {
    methods: ["POST"]
    pattern: '/account/two-factor/begin'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/two_factor_controller').default['begin']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/two_factor_controller').default['begin']>>>
    }
  }
  'two_factor.confirm': {
    methods: ["POST"]
    pattern: '/account/two-factor/confirm'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/two_factor_controller').default['confirm']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/two_factor_controller').default['confirm']>>>
    }
  }
  'two_factor.regenerate': {
    methods: ["POST"]
    pattern: '/account/two-factor/recovery-codes'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/two_factor_controller').default['regenerate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/two_factor_controller').default['regenerate']>>>
    }
  }
  'two_factor.destroy': {
    methods: ["DELETE"]
    pattern: '/account/two-factor'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/two_factor_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/two_factor_controller').default['destroy']>>>
    }
  }
  'delegations.index': {
    methods: ["GET","HEAD"]
    pattern: '/account/delegations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['index']>>>
    }
  }
  'delegations.candidates': {
    methods: ["GET","HEAD"]
    pattern: '/account/delegations/candidates'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['candidates']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['candidates']>>>
    }
  }
  'delegations.store': {
    methods: ["POST"]
    pattern: '/account/delegations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['store']>>>
    }
  }
  'delegations.destroy': {
    methods: ["DELETE"]
    pattern: '/account/delegations/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['destroy']>>>
    }
  }
  'account_sessions.index': {
    methods: ["GET","HEAD"]
    pattern: '/account/sessions'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/account_sessions_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/account_sessions_controller').default['index']>>>
    }
  }
  'account_sessions.purge': {
    methods: ["DELETE"]
    pattern: '/account/sessions'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/account_sessions_controller').default['purge']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/account_sessions_controller').default['purge']>>>
    }
  }
  'account_sessions.destroy': {
    methods: ["DELETE"]
    pattern: '/account/sessions/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/account_sessions_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/account_sessions_controller').default['destroy']>>>
    }
  }
  'oauth.link': {
    methods: ["POST"]
    pattern: '/account/connections/:provider'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { provider: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/oauth_controller').default['link']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/oauth_controller').default['link']>>>
    }
  }
  'oauth.unlink': {
    methods: ["DELETE"]
    pattern: '/account/connections/:provider'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { provider: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/oauth_controller').default['unlink']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/oauth_controller').default['unlink']>>>
    }
  }
  'admin_sessions.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/sessions'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_sessions_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_sessions_controller').default['index']>>>
    }
  }
  'admin_sessions.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/sessions/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin_sessions_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin_sessions_controller').default['destroy']>>>
    }
  }
  'notifications.index': {
    methods: ["GET","HEAD"]
    pattern: '/notifications'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/notifications_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/notifications_controller').default['index']>>>
    }
  }
  'notifications.read_all': {
    methods: ["POST"]
    pattern: '/notifications/read-all'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/notifications_controller').default['readAll']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/notifications_controller').default['readAll']>>>
    }
  }
  'notifications.read': {
    methods: ["POST"]
    pattern: '/notifications/:id/read'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/notifications_controller').default['read']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/notifications_controller').default['read']>>>
    }
  }
  'notifications.open': {
    methods: ["GET","HEAD"]
    pattern: '/notifications/:id/open'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/notifications_controller').default['open']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/notifications_controller').default['open']>>>
    }
  }
  'admin_users.stop_impersonation': {
    methods: ["POST"]
    pattern: '/impersonation/stop'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['stopImpersonation']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['stopImpersonation']>>>
    }
  }
  'admin_users.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/users'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['index']>>>
    }
  }
  'admin_users.show': {
    methods: ["GET","HEAD"]
    pattern: '/admin/users/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['show']>>>
    }
  }
  'admin_users.assign_role': {
    methods: ["POST"]
    pattern: '/admin/users/:id/roles'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['assignRole']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['assignRole']>>>
    }
  }
  'admin_users.remove_role': {
    methods: ["DELETE"]
    pattern: '/admin/users/:id/roles/:assignment'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; assignment: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['removeRole']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['removeRole']>>>
    }
  }
  'admin_users.assign_org_unit': {
    methods: ["POST"]
    pattern: '/admin/users/:id/org-units'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['assignOrgUnit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['assignOrgUnit']>>>
    }
  }
  'admin_users.remove_org_unit': {
    methods: ["DELETE"]
    pattern: '/admin/users/:id/org-units/:orgUnit'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; orgUnit: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['removeOrgUnit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['removeOrgUnit']>>>
    }
  }
  'admin_users.disable': {
    methods: ["POST"]
    pattern: '/admin/users/:id/disable'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['disable']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['disable']>>>
    }
  }
  'admin_users.enable': {
    methods: ["POST"]
    pattern: '/admin/users/:id/enable'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['enable']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['enable']>>>
    }
  }
  'admin_users.revoke_sessions': {
    methods: ["POST"]
    pattern: '/admin/users/:id/revoke-sessions'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['revokeSessions']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['revokeSessions']>>>
    }
  }
  'admin_users.revoke_tokens': {
    methods: ["POST"]
    pattern: '/admin/users/:id/revoke-tokens'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['revokeTokens']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['revokeTokens']>>>
    }
  }
  'admin_users.reset_two_factor': {
    methods: ["POST"]
    pattern: '/admin/users/:id/reset-two-factor'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['resetTwoFactor']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['resetTwoFactor']>>>
    }
  }
  'admin_users.impersonate': {
    methods: ["POST"]
    pattern: '/admin/users/:id/impersonate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['impersonate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/users_controller').default['impersonate']>>>
    }
  }
  'avatars.store_for': {
    methods: ["POST"]
    pattern: '/admin/users/:id/avatar'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/avatars_controller').default['storeFor']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/avatars_controller').default['storeFor']>>>
    }
  }
  'avatars.destroy_for': {
    methods: ["DELETE"]
    pattern: '/admin/users/:id/avatar'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/avatars_controller').default['destroyFor']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/avatars_controller').default['destroyFor']>>>
    }
  }
  'admin_roles.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/roles'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['index']>>>
    }
  }
  'admin_roles.store': {
    methods: ["POST"]
    pattern: '/admin/roles'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['store']>>>
    }
  }
  'admin_roles.show': {
    methods: ["GET","HEAD"]
    pattern: '/admin/roles/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['show']>>>
    }
  }
  'admin_roles.update': {
    methods: ["PATCH"]
    pattern: '/admin/roles/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['update']>>>
    }
  }
  'admin_roles.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/roles/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['destroy']>>>
    }
  }
  'admin_roles.set_rule': {
    methods: ["PUT"]
    pattern: '/admin/roles/:id/rules'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['setRule']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['setRule']>>>
    }
  }
  'admin_roles.remove_rule': {
    methods: ["DELETE"]
    pattern: '/admin/roles/:id/rules/:rule'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; rule: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['removeRule']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/roles_controller').default['removeRule']>>>
    }
  }
  'admin_org_units.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/org-units'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/org_units_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/org_units_controller').default['index']>>>
    }
  }
  'admin_org_units.store': {
    methods: ["POST"]
    pattern: '/admin/org-units'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/org_units_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/org_units_controller').default['store']>>>
    }
  }
  'admin_org_units.update': {
    methods: ["PATCH"]
    pattern: '/admin/org-units/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/org_units_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/org_units_controller').default['update']>>>
    }
  }
  'admin_org_units.move': {
    methods: ["POST"]
    pattern: '/admin/org-units/:id/move'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/org_units_controller').default['move']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/org_units_controller').default['move']>>>
    }
  }
  'admin_org_units.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/org-units/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/org_units_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/org_units_controller').default['destroy']>>>
    }
  }
  'admin_activity.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/activity'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/activity_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/activity_controller').default['index']>>>
    }
  }
  'admin_jobs.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/jobs'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/jobs_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/jobs_controller').default['index']>>>
    }
  }
  'admin_backups.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/backups'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['index']>>>
    }
  }
  'admin_backups.connect': {
    methods: ["POST"]
    pattern: '/admin/backups/connect/:provider'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { provider: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['connect']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['connect']>>>
    }
  }
  'admin_backups.callback': {
    methods: ["GET","HEAD"]
    pattern: '/admin/backups/oauth/:provider/callback'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { provider: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['callback']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['callback']>>>
    }
  }
  'admin_backups.disconnect': {
    methods: ["DELETE"]
    pattern: '/admin/backups/connections/:provider'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { provider: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['disconnect']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['disconnect']>>>
    }
  }
  'admin_backups.schedule': {
    methods: ["PUT"]
    pattern: '/admin/backups/connections/:provider/schedule'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { provider: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['schedule']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['schedule']>>>
    }
  }
  'admin_backups.run': {
    methods: ["POST"]
    pattern: '/admin/backups/runs'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['run']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['run']>>>
    }
  }
  'admin_backups.download': {
    methods: ["GET","HEAD"]
    pattern: '/admin/backups/runs/:id/download'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['download']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/backups_controller').default['download']>>>
    }
  }
  'admin_jobs.retry': {
    methods: ["POST"]
    pattern: '/admin/jobs/:id/retry'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/jobs_controller').default['retry']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/jobs_controller').default['retry']>>>
    }
  }
  'admin_jobs.run_sync': {
    methods: ["POST"]
    pattern: '/admin/jobs/sync/:name/run'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { name: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/jobs_controller').default['runSync']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/jobs_controller').default['runSync']>>>
    }
  }
  'admin_jobs.sync_runs': {
    methods: ["GET","HEAD"]
    pattern: '/admin/jobs/sync/:name/runs'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { name: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/jobs_controller').default['syncRuns']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/jobs_controller').default['syncRuns']>>>
    }
  }
  'admin_settings.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/settings'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['index']>>>
    }
  }
  'admin_settings.mail': {
    methods: ["GET","HEAD"]
    pattern: '/admin/settings/mail'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['mail']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['mail']>>>
    }
  }
  'admin_templates.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/templates'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/templates_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/templates_controller').default['index']>>>
    }
  }
  'admin_templates.update': {
    methods: ["PUT"]
    pattern: '/admin/templates/:key'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/templates_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/templates_controller').default['update']>>>
    }
  }
  'admin_templates.reset': {
    methods: ["DELETE"]
    pattern: '/admin/templates/:key'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/templates_controller').default['reset']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/templates_controller').default['reset']>>>
    }
  }
  'admin_print_templates.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/print-templates'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['index']>>>
    }
  }
  'admin_print_templates.store': {
    methods: ["POST"]
    pattern: '/admin/print-templates'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['store']>>>
    }
  }
  'admin_print_templates.preview': {
    methods: ["POST"]
    pattern: '/admin/print-templates/preview'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['preview']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['preview']>>>
    }
  }
  'admin_print_templates.show': {
    methods: ["GET","HEAD"]
    pattern: '/admin/print-templates/:resource/:key'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['show']>>>
    }
  }
  'admin_print_templates.update': {
    methods: ["PUT"]
    pattern: '/admin/print-templates/:resource/:key'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['update']>>>
    }
  }
  'admin_print_templates.versions': {
    methods: ["GET","HEAD"]
    pattern: '/admin/print-templates/:resource/:key/versions'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { resource: ParamValue; key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['versions']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/print_templates_controller').default['versions']>>>
    }
  }
  'workflows.failed': {
    methods: ["GET","HEAD"]
    pattern: '/admin/workflows'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/workflows_controller').default['failed']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/workflows_controller').default['failed']>>>
    }
  }
  'workflows.retry': {
    methods: ["POST"]
    pattern: '/admin/workflows/:run/retry'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { run: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/workflows_controller').default['retry']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/workflows_controller').default['retry']>>>
    }
  }
  'delegations.admin_index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/delegations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['adminIndex']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['adminIndex']>>>
    }
  }
  'delegations.admin_candidates': {
    methods: ["GET","HEAD"]
    pattern: '/admin/delegations/candidates'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['adminCandidates']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['adminCandidates']>>>
    }
  }
  'delegations.admin_store': {
    methods: ["POST"]
    pattern: '/admin/delegations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['adminStore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['adminStore']>>>
    }
  }
  'delegations.admin_destroy': {
    methods: ["DELETE"]
    pattern: '/admin/delegations/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['adminDestroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/delegations_controller').default['adminDestroy']>>>
    }
  }
  'admin_webhooks.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/webhooks'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['index']>>>
    }
  }
  'admin_webhooks.store': {
    methods: ["POST"]
    pattern: '/admin/webhooks'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['store']>>>
    }
  }
  'admin_webhooks.update': {
    methods: ["PUT"]
    pattern: '/admin/webhooks/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['update']>>>
    }
  }
  'admin_webhooks.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/webhooks/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['destroy']>>>
    }
  }
  'admin_webhooks.deliveries': {
    methods: ["GET","HEAD"]
    pattern: '/admin/webhooks/:id/deliveries'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['deliveries']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['deliveries']>>>
    }
  }
  'admin_webhooks.retry': {
    methods: ["POST"]
    pattern: '/admin/webhooks/deliveries/:delivery/retry'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { delivery: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['retry']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['retry']>>>
    }
  }
  'admin_webhooks.store_inbound': {
    methods: ["POST"]
    pattern: '/admin/inbound-webhooks'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['storeInbound']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['storeInbound']>>>
    }
  }
  'admin_webhooks.update_inbound': {
    methods: ["PUT"]
    pattern: '/admin/inbound-webhooks/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['updateInbound']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['updateInbound']>>>
    }
  }
  'admin_webhooks.rotate_inbound': {
    methods: ["POST"]
    pattern: '/admin/inbound-webhooks/:id/rotate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['rotateInbound']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['rotateInbound']>>>
    }
  }
  'admin_webhooks.destroy_inbound': {
    methods: ["DELETE"]
    pattern: '/admin/inbound-webhooks/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['destroyInbound']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['destroyInbound']>>>
    }
  }
  'admin_webhooks.inbound_deliveries': {
    methods: ["GET","HEAD"]
    pattern: '/admin/inbound-webhooks/:id/deliveries'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['inboundDeliveries']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['inboundDeliveries']>>>
    }
  }
  'admin_webhooks.redispatch_inbound': {
    methods: ["POST"]
    pattern: '/admin/inbound-webhooks/deliveries/:delivery/redispatch'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { delivery: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['redispatchInbound']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/webhooks_controller').default['redispatchInbound']>>>
    }
  }
  'setup.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/setup'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/setup_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/setup_controller').default['index']>>>
    }
  }
  'setup.check': {
    methods: ["POST"]
    pattern: '/admin/setup/check/:service'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { service: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/setup_controller').default['check']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/setup_controller').default['check']>>>
    }
  }
  'setup.confirm_identity': {
    methods: ["POST"]
    pattern: '/admin/setup/identity'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/setup_controller').default['confirmIdentity']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/setup_controller').default['confirmIdentity']>>>
    }
  }
  'setup.notification': {
    methods: ["POST"]
    pattern: '/admin/setup/notification'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/setup_controller').default['notification']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/setup_controller').default['notification']>>>
    }
  }
  'admin_settings.test_mail': {
    methods: ["POST"]
    pattern: '/admin/settings/mail/test'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['testMail']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['testMail']>>>
    }
  }
  'admin_settings.confirm_mail': {
    methods: ["POST"]
    pattern: '/admin/settings/mail/confirm'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['confirmMail']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['confirmMail']>>>
    }
  }
  'admin_settings.update_mail': {
    methods: ["PUT"]
    pattern: '/admin/settings/mail'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['updateMail']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['updateMail']>>>
    }
  }
  'admin_settings.set_mail_password': {
    methods: ["PUT"]
    pattern: '/admin/settings/mail/password'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['setMailPassword']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['setMailPassword']>>>
    }
  }
  'admin_settings.clear_mail_password': {
    methods: ["DELETE"]
    pattern: '/admin/settings/mail/password'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['clearMailPassword']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['clearMailPassword']>>>
    }
  }
  'admin_settings.upsert': {
    methods: ["PUT"]
    pattern: '/admin/settings'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['upsert']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['upsert']>>>
    }
  }
  'admin_authentication_settings.update': {
    methods: ["PUT"]
    pattern: '/admin/settings/authentication'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/authentication_settings').authenticationSettingsValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/authentication_settings').authenticationSettingsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/authentication_settings_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/authentication_settings_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin_settings.update_channel': {
    methods: ["PUT"]
    pattern: '/admin/settings/channels'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['updateChannel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['updateChannel']>>>
    }
  }
  'admin_settings.rotate_channel': {
    methods: ["POST"]
    pattern: '/admin/settings/channels/rotate'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['rotateChannel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['rotateChannel']>>>
    }
  }
  'admin_settings.test_channel': {
    methods: ["POST"]
    pattern: '/admin/settings/channels/test'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['testChannel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['testChannel']>>>
    }
  }
  'admin_settings.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/settings/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['destroy']>>>
    }
  }
  'api_tokens.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/tokens'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/api_tokens_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/api_tokens_controller').default['index']>>>
    }
  }
  'api_tokens.store': {
    methods: ["POST"]
    pattern: '/admin/tokens'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/api_tokens_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/api_tokens_controller').default['store']>>>
    }
  }
  'api_tokens.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/tokens/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/api_tokens_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/api_tokens_controller').default['destroy']>>>
    }
  }
  'admin_appearance.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/appearance'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['index']>>>
    }
  }
  'admin_appearance.update_identity': {
    methods: ["PUT"]
    pattern: '/admin/appearance'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['updateIdentity']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['updateIdentity']>>>
    }
  }
  'admin_appearance.reset_identity': {
    methods: ["DELETE"]
    pattern: '/admin/appearance'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['resetIdentity']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['resetIdentity']>>>
    }
  }
  'admin_appearance.upload_logo': {
    methods: ["POST"]
    pattern: '/admin/appearance/logos'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['uploadLogo']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['uploadLogo']>>>
    }
  }
  'admin_appearance.store_occasion': {
    methods: ["POST"]
    pattern: '/admin/appearance/occasions'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['storeOccasion']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['storeOccasion']>>>
    }
  }
  'admin_appearance.update_occasion': {
    methods: ["PUT"]
    pattern: '/admin/appearance/occasions/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['updateOccasion']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['updateOccasion']>>>
    }
  }
  'admin_appearance.destroy_occasion': {
    methods: ["DELETE"]
    pattern: '/admin/appearance/occasions/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['destroyOccasion']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/appearance_controller').default['destroyOccasion']>>>
    }
  }
  'admin_assistant.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/assistant'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/assistant_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/assistant_controller').default['index']>>>
    }
  }
  'admin_assistant.update': {
    methods: ["PUT"]
    pattern: '/admin/assistant'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/assistant_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/assistant_controller').default['update']>>>
    }
  }
  'admin_assistant.set_key': {
    methods: ["PUT"]
    pattern: '/admin/assistant/key'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/assistant_controller').default['setKey']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/assistant_controller').default['setKey']>>>
    }
  }
  'admin_assistant.clear_key': {
    methods: ["DELETE"]
    pattern: '/admin/assistant/key'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/assistant_controller').default['clearKey']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/assistant_controller').default['clearKey']>>>
    }
  }
  'admin_assistant.test': {
    methods: ["POST"]
    pattern: '/admin/assistant/test'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/assistant_controller').default['test']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/assistant_controller').default['test']>>>
    }
  }
  'admin_lookups.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/lookups'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['index']>>>
    }
  }
  'admin_lookups.store': {
    methods: ["POST"]
    pattern: '/admin/lookups'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['store']>>>
    }
  }
  'admin_lookups.reorder': {
    methods: ["PUT"]
    pattern: '/admin/lookups/groups/:group/order'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { group: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['reorder']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['reorder']>>>
    }
  }
  'admin_lookups.update': {
    methods: ["PATCH"]
    pattern: '/admin/lookups/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['update']>>>
    }
  }
  'admin_lookups.disable': {
    methods: ["POST"]
    pattern: '/admin/lookups/:id/disable'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['disable']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['disable']>>>
    }
  }
  'admin_lookups.enable': {
    methods: ["POST"]
    pattern: '/admin/lookups/:id/enable'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['enable']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['enable']>>>
    }
  }
  'admin_lookups.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/lookups/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/lookups_controller').default['destroy']>>>
    }
  }
  'admin_sequences.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/sequences'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/sequences_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/sequences_controller').default['index']>>>
    }
  }
  'admin_sequences.update': {
    methods: ["PATCH"]
    pattern: '/admin/sequences/:key'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/sequences_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/sequences_controller').default['update']>>>
    }
  }
}
