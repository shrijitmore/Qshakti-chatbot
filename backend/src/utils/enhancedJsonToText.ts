// Enhanced JSON to text converter with relationship mapping
import { schemaMapper } from './schemaMapper';

export interface ConversionOptions {
  maxArrayItems?: number;
  includeRelationships?: boolean;
  maxRelationshipDepth?: number;
  tableName?: string;
}

export class EnhancedJsonToText {
  
  private buildRelationshipNarrative(
    record: any, 
    tableName: string, 
    depth: number = 0, 
    maxDepth: number = 2,
    visited: Set<string> = new Set()
  ): string[] {
    if (depth >= maxDepth) return [];
    
    const narratives: string[] = [];
    const recordKey = `${tableName}:${record.id || record[Object.keys(record)[0]]}`;
    
    if (visited.has(recordKey)) return [];
    visited.add(recordKey);
    
    const relatedTables = schemaMapper.getRelatedTables(tableName);
    
    for (const relation of relatedTables) {
      if (relation.type === 'foreign_key') {
        const value = record[relation.via];
        if (value) {
          const referencedRecord = schemaMapper.resolveReference(tableName, relation.via, value);
          if (referencedRecord) {
            const narrative = this.createHumanReadableReference(
              relation.table, 
              referencedRecord, 
              relation.via
            );
            if (narrative) {
              narratives.push(narrative);
              
              // Recursively get relationships of referenced record
              const subNarratives = this.buildRelationshipNarrative(
                referencedRecord, 
                relation.table, 
                depth + 1, 
                maxDepth, 
                visited
              );
              narratives.push(...subNarratives);
            }
          }
        }
      }
    }
    
    return narratives;
  }

  private createHumanReadableReference(tableName: string, record: any, viaColumn: string): string | null {
    // Create human-readable narratives based on table type
    const tableType = this.identifyTableType(tableName);
    
    switch (tableType) {
      case 'user':
        return this.createUserNarrative(record);
      case 'plant':
        return this.createPlantNarrative(record);
      case 'machine':
        return this.createMachineNarrative(record);
      case 'operation':
        return this.createOperationNarrative(record);
      case 'inspection':
        return this.createInspectionNarrative(record);
      case 'item':
        return this.createItemNarrative(record);
      case 'role':
        return this.createRoleNarrative(record);
      default:
        return this.createGenericNarrative(tableName, record, viaColumn);
    }
  }

  private identifyTableType(tableName: string): string {
    const name = tableName.toLowerCase();
    if (name.includes('user') || name.includes('auth_user')) return 'user';
    if (name.includes('plant')) return 'plant';
    if (name.includes('machine')) return 'machine';
    if (name.includes('operation')) return 'operation';
    if (name.includes('inspection')) return 'inspection';
    if (name.includes('item') || name.includes('material')) return 'item';
    if (name.includes('role') || name.includes('group')) return 'role';
    return 'generic';
  }

  private createUserNarrative(record: any): string | null {
    const parts: string[] = [];
    
    if (record.first_name || record.last_name) {
      const name = [record.first_name, record.middle_name, record.last_name]
        .filter(Boolean)
        .join(' ');
      parts.push(`User: ${name}`);
    } else if (record.username) {
      parts.push(`User: ${record.username}`);
    }
    
    if (record.email) parts.push(`Email: ${record.email}`);
    if (record.phone_number) parts.push(`Phone: ${record.phone_number}`);
    
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private createPlantNarrative(record: any): string | null {
    const parts: string[] = [];
    
    if (record.plant_name) {
      parts.push(`Plant: ${record.plant_name}`);
    }
    
    if (record.plant_id) {
      parts.push(`ID: ${record.plant_id}`);
    }
    
    if (record.plant_location_1 || record.plant_location_2) {
      const location = [record.plant_location_1, record.plant_location_2]
        .filter(Boolean)
        .join(', ');
      if (location) parts.push(`Location: ${location}`);
    }
    
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private createMachineNarrative(record: any): string | null {
    const parts: string[] = [];
    
    if (record.machine_name) {
      parts.push(`Machine: ${record.machine_name}`);
    }
    
    if (record.machine_id) {
      parts.push(`ID: ${record.machine_id}`);
    }
    
    if (record.machine_make && record.machine_model) {
      parts.push(`Make/Model: ${record.machine_make} ${record.machine_model}`);
    }
    
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private createOperationNarrative(record: any): string | null {
    const parts: string[] = [];
    
    if (record.operation_name) {
      parts.push(`Operation: ${record.operation_name}`);
    }
    
    if (record.operation_id) {
      parts.push(`ID: ${record.operation_id}`);
    }
    
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private createInspectionNarrative(record: any): string | null {
    const parts: string[] = [];
    
    if (record.inspection_parameter) {
      parts.push(`Parameter: ${record.inspection_parameter}`);
    }
    
    if (record.inspection_frequency) {
      parts.push(`Frequency: ${record.inspection_frequency}`);
    }
    
    if (record.LSL !== null && record.USL !== null) {
      parts.push(`Limits: ${record.LSL} - ${record.USL}`);
    }
    
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private createItemNarrative(record: any): string | null {
    const parts: string[] = [];
    
    if (record.item_description || record.item_name) {
      parts.push(`Item: ${record.item_description || record.item_name}`);
    }
    
    if (record.item_code) {
      parts.push(`Code: ${record.item_code}`);
    }
    
    if (record.item_type) {
      parts.push(`Type: ${record.item_type}`);
    }
    
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private createRoleNarrative(record: any): string | null {
    const parts: string[] = [];
    
    if (record.name) {
      parts.push(`Role: ${record.name}`);
    }
    
    if (record.description) {
      parts.push(`Description: ${record.description}`);
    }
    
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private createGenericNarrative(tableName: string, record: any, viaColumn: string): string | null {
    // Try to find meaningful fields for display
    const displayFields = ['name', 'title', 'description', 'id'];
    const parts: string[] = [];
    
    for (const field of displayFields) {
      if (record[field] && typeof record[field] === 'string') {
        parts.push(`${field}: ${record[field]}`);
        break; // Only take the first meaningful field
      }
    }
    
    return parts.length > 0 ? `${tableName} (${parts.join(', ')})` : null;
  }

  convertToText(
    record: any, 
    options: ConversionOptions = {}
  ): string {
    const {
      includeRelationships = true,
      maxRelationshipDepth = 2,
      tableName = 'unknown'
    } = options;

    const sections: string[] = [];
    
    // Main record section
    sections.push(`=== ${tableName.toUpperCase()} RECORD ===`);
    
    // Add core record data
    const coreData = this.extractCoreData(record);
    if (coreData.length > 0) {
      sections.push(...coreData);
    }
    
    // Add relationship narratives
    if (includeRelationships) {
      const relationships = this.buildRelationshipNarrative(
        record, 
        tableName, 
        0, 
        maxRelationshipDepth
      );
      
      if (relationships.length > 0) {
        sections.push('\n--- RELATIONSHIPS ---');
        sections.push(...relationships);
      }
    }
    
    return sections.join('\n');
  }

  private extractCoreData(record: any): string[] {
    const lines: string[] = [];
    const skipFields = ['created_at', 'updated_at', 'is_active'];
    
    for (const [key, value] of Object.entries(record)) {
      if (skipFields.includes(key)) continue;
      
      if (value !== null && value !== undefined) {
        if (typeof value === 'object' && !Array.isArray(value)) {
          // Skip nested objects as they'll be handled by relationships
          continue;
        } else if (Array.isArray(value)) {
          lines.push(`${key}: [${value.slice(0, 3).join(', ')}${value.length > 3 ? '...' : ''}]`);
        } else {
          lines.push(`${key}: ${value}`);
        }
      }
    }
    
    return lines;
  }

  // Batch conversion for multiple records
  convertManyToText(
    records: any[], 
    tableName: string, 
    options: ConversionOptions = {}
  ): string {
    const chunks: string[] = [];
    
    for (const record of records) {
      const text = this.convertToText(record, { ...options, tableName });
      if (text.trim().length > 50) { // Only include meaningful chunks
        chunks.push(text);
      }
    }
    
    return chunks.join('\n\n' + '='.repeat(50) + '\n\n');
  }
}

export const enhancedJsonToText = new EnhancedJsonToText();