// Azure Container Apps infrastructure
// Template variables: {{appName}}, {{region}}, {{sku}}, {{port}}, {{baseImage}}

@description('Application name')
param appName string = '{{appName}}'

@description('Azure region')
param location string = '{{region}}'

param tags object = {
  app: appName
  managedBy: 'platform-engineer-agent'
}

// ── Monitoring (shared module) ──────────────────────────────────────

module monitoring '../common/main.bicep' = {
  name: 'monitoring'
  params: {
    appName: appName
    location: location
    tags: tags
  }
}

// ── Container Registry ──────────────────────────────────────────────

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: take('acr${replace(appName, '-', '')}', 50)
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// ── Container Apps Environment ──────────────────────────────────────

resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${appName}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: monitoring.outputs.logAnalyticsId
      }
    }
  }
}

// ── Container App ───────────────────────────────────────────────────

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${appName}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${monitoring.outputs.managedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: {{port}}
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: monitoring.outputs.managedIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: appName
          image: '{{baseImage}}'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: monitoring.outputs.appInsightsConnectionString }
            { name: 'PORT', value: '{{port}}' }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 10
        rules: [
          {
            name: 'http-rule'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

// ── Outputs ─────────────────────────────────────────────────────────

output containerAppName string = containerApp.name
output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output acrLoginServer string = acr.properties.loginServer
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
